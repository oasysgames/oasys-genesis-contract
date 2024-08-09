// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import { System } from "./System.sol";
import { IEnvironment } from "./IEnvironment.sol";
import { UpdateHistories } from "./lib/UpdateHistories.sol";
import { PastEpoch } from "./lib/Errors.sol";
import { EnvironmentValue as EnvironmentValueLib } from "./lib/EnvironmentValue.sol";
import { Chain } from "./lib/Chain.sol";

// Not executable in the last block of epoch.
error OnlyNotLastBlock();

/**
 * @title Environment
 * @dev The Environment contract has parameters for proof-of-stake.
 */
contract Environment is IEnvironment, System {
    using UpdateHistories for uint256[];
    using EnvironmentValueLib for EnvironmentValue;

    /*************
     * Variables *
     *************/

    // Update history of environment values
    uint256[] public updates;
    EnvironmentValue[] public values;

    /****************************
     * Functions for Validators *
     ****************************/

    /**
     * @inheritdoc IEnvironment
     */
    function initialize(EnvironmentValue memory initialValue) external onlyCoinbase initializer {
        initialValue.startBlock = 0;
        initialValue.startEpoch = 1;
        _updateValue(initialValue);
    }

    /**
     * @inheritdoc IEnvironment
     */
    function updateValue(EnvironmentValue memory newValue) external onlyCoinbase {
        if (isLastBlock()) revert OnlyNotLastBlock();
        if (newValue.startEpoch <= epoch()) revert PastEpoch();

        EnvironmentValue storage latest = _latestValue();
        if (latest.started(block.number)) {
            newValue.startBlock = latest.nextStartBlock(newValue);
        } else {
            newValue.startBlock = _prevValue().nextStartBlock(newValue);
        }
        _updateValue(newValue);
    }

    /******************
     * View Functions *
     ******************/

    /**
     * @inheritdoc IEnvironment
     */
    function epoch() public view returns (uint256) {
        return _value().epoch();
    }

    /**
     * @inheritdoc IEnvironment
     */
    function isFirstBlock() external view returns (bool) {
        EnvironmentValue storage current = _value();
        return (block.number - current.startBlock) % current.epochPeriod == 0;
    }

    /**
     * @inheritdoc IEnvironment
     */
    function isLastBlock() public view returns (bool) {
        EnvironmentValue storage current = _value();
        return (block.number - current.startBlock + 1) % current.epochPeriod == 0;
    }

    /**
     * @inheritdoc IEnvironment
     */
    function value() public view returns (EnvironmentValue memory) {
        return _value();
    }

    /**
     * @inheritdoc IEnvironment
     */
    function nextValue() external view returns (EnvironmentValue memory) {
        EnvironmentValue storage current = _value();
        EnvironmentValue storage latest = _latestValue();
        uint256 nextStartBlock = current.startBlock + (current.epoch() - current.startEpoch + 1) * current.epochPeriod;
        return latest.started(nextStartBlock) ? latest : current;
    }

    /**
     * @inheritdoc IEnvironment
     */
    function findValue(uint256 _epoch) external view returns (EnvironmentValue memory) {
        return updates.find(values, _epoch);
    }

    /*********************
     * Private Functions *
     *********************/

    /**
    * Returns the environment value at the current epoch
    * @return Environment value.
    */
    function _value() internal view returns (EnvironmentValue storage) {
        EnvironmentValue storage latest = _latestValue();
        return latest.started(block.number) ? latest : _prevValue();
    }

    /**
     * Returns the previous (or latest) environment value.
     * @return Environment value.
     */
    function _prevValue() internal view returns (EnvironmentValue storage) {
        uint256 length = values.length;
        if (length == 1) {
            return values[0];
        }
        return values[length - 2];
    }

    /**
     * Returns the latest environment value.
     * @return Environment value.
     */
    function _latestValue() internal view returns (EnvironmentValue storage) {
        return values[values.length - 1];
    }

    /**
     * Validate the new environment value and if there are no problems, save to storage.
     * @param newValue New environment value.
     */
    function _updateValue(EnvironmentValue memory newValue) private {
        newValue.validate();

        if (Chain.isMainnet() || Chain.isTestnet()) {
            newValue.validateEpoch();
        }

        uint256 length = updates.length;
        if (length == 0 || values[length - 1].started(block.number)) {
            updates.push(newValue.startEpoch);
            values.push(newValue);
        } else {
            updates[length - 1] = newValue.startEpoch;
            values[length - 1] = newValue;
        }
    }
}
