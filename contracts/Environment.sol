// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import { System } from "./System.sol";
import { EnvironmentValue as EnvironmentValueLib } from "./lib/EnvironmentValue.sol";

/**
 * @title Environment
 * @dev The Environment contract has parameters for proof-of-stake.
 */
contract Environment is System {
    using EnvironmentValueLib for EnvironmentValue;

    /***********
     * Structs *
     ***********/

    struct EnvironmentValue {
        // Block and epoch to which this setting applies
        uint256 startBlock;
        uint256 startEpoch;
        // Block generation interval(by seconds)
        uint256 blockPeriod;
        // Number of blocks in epoch
        uint256 epochPeriod;
        // Annual rate of staking reward
        uint256 rewardRate;
        // Amount of tokens required to become a validator
        uint256 validatorThreshold;
        // Number of not sealed to jailing the validator
        uint256 jailThreshold;
        // Number of epochs to jailing the validator
        uint256 jailPeriod;
    }

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
     * Initialization of contract.
     * This method is called by the genesis validator in the first epoch.
     * @param initialValue Initial environment value.
     */
    function initialize(EnvironmentValue memory initialValue) external onlyCoinbase initializer {
        initialValue.startBlock = 0;
        initialValue.startEpoch = 1;
        _updateValue(initialValue);
    }

    /**
     * Set the new environment value.
     * This method can only be called by validator, and the values are validated by other validators.
     * The new settings are applied starting at the epoch specified by "startEpoch".
     * @param newValue New environment value.
     */
    function updateValue(EnvironmentValue memory newValue) external onlyCoinbase {
        // solhint-disable-next-line reason-string
        require(!isLastBlock(), "not executable in the last block of epoch.");
        require(newValue.startEpoch > epoch(), "startEpoch must be future.");

        EnvironmentValue storage next = _getNext();
        if (next.started(block.number)) {
            newValue.startBlock = next.nextStartBlock(newValue);
        } else {
            newValue.startBlock = _getCurrent().nextStartBlock(newValue);
        }
        _updateValue(newValue);
    }

    /******************
     * View Functions *
     ******************/

    /**
     * Returns the current epoch number.
     * @return Current epoch number.
     */
    function epoch() public view returns (uint256) {
        EnvironmentValue storage next = _getNext();
        return next.started(block.number) ? next.epoch() : _getCurrent().epoch();
    }

    /**
     * Determine if the current block is the first block of the epoch.
     * @return If true, it is the first block of the epoch.
     */
    function isFirstBlock() public view returns (bool) {
        return (block.number) % value().epochPeriod == 0;
    }

    /**
     * Determine if the current block is the last block of the epoch.
     * @return If true, it is the last block of the epoch.
     */
    function isLastBlock() public view returns (bool) {
        return (block.number + 1) % value().epochPeriod == 0;
    }

    /**
     * Returns the environment value at the current epoch
     * @return Environment value.
     */
    function value() public view returns (EnvironmentValue memory) {
        EnvironmentValue storage next = _getNext();
        return next.started(block.number) ? next : _getCurrent();
    }

    /**
     * Returns the environment value for the next epoch.
     * @return Environment value.
     */
    function nextValue() external view returns (EnvironmentValue memory) {
        EnvironmentValue storage next = _getNext();
        return next.started(block.number + 1) ? next : _getCurrent();
    }

    /**
     * Returns list of the update history of environment values
     * @return epochs List of epoch numbers to which the values apply.
     * @return _values List of environment values.
     */
    function epochAndValues() public view returns (uint256[] memory epochs, EnvironmentValue[] memory _values) {
        return (updates, values);
    }

    /*********************
     * Private Functions *
     *********************/

    /**
     * Returns the current (or previous) environment value.
     * @return Environment value.
     */
    function _getCurrent() internal view returns (EnvironmentValue storage) {
        uint256 length = values.length;
        if (length == 1) {
            return values[0];
        }
        return values[length - 2];
    }

    /**
     * Returns the next (or current) environment value.
     * @return Environment value.
     */
    function _getNext() internal view returns (EnvironmentValue storage) {
        uint256 length = values.length;
        if (length == 1) {
            return values[0];
        }
        return values[length - 1];
    }

    /**
     * Validate the new environment value and if there are no problems, save to storage.
     * @param _value New environment value.
     */
    function _updateValue(EnvironmentValue memory _value) private {
        _value.validate();

        uint256 length = updates.length;
        if (length == 0 || values[length - 1].started(block.number)) {
            updates.push(_value.startEpoch);
            values.push(_value);
        } else {
            updates[length - 1] = _value.startEpoch;
            values[length - 1] = _value;
        }
    }
}
