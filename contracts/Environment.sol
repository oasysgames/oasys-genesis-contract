// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import { System } from "./System.sol";
import { UpdateHistoriesLib } from "./lib/Common.sol";
import { IEnvironment, EnvironmentLib } from "./IEnvironment.sol";

contract Environment is System, IEnvironment {
    using EnvironmentLib for Environment;

    /*************
     * Variables *
     *************/

    // History of environment values
    uint256[] public updates;
    Environment[] public values;

    /****************************
     * Functions for Validators *
     ****************************/

    function initialize(Environment memory initialValue) external onlyCoinbase initializer {
        initialValue.startBlock = 0;
        initialValue.startEpoch = 1;
        _updateValue(initialValue);
    }

    function updateValue(Environment memory newValue) external onlyCoinbase {
        // solhint-disable-next-line reason-string
        require(!isLastBlock(), "not executable in the last block of epoch.");
        require(newValue.startEpoch > epoch(), "startEpoch must be future.");

        Environment storage next = _getNext();
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

    function epoch() public view override returns (uint256) {
        Environment storage next = _getNext();
        return next.started(block.number) ? next.epoch() : _getCurrent().epoch();
    }

    function isFirstBlock() public view override returns (bool) {
        return (block.number) % value().epochPeriod == 0;
    }

    function isLastBlock() public view override returns (bool) {
        return (block.number + 1) % value().epochPeriod == 0;
    }

    function value() public view override returns (Environment memory) {
        Environment storage next = _getNext();
        return next.started(block.number) ? next : _getCurrent();
    }

    function nextValue() external view returns (Environment memory) {
        Environment storage next = _getNext();
        return next.started(block.number + 1) ? next : _getCurrent();
    }

    function epochAndValues() public view override returns (uint256[] memory epochs, Environment[] memory _values) {
        return (updates, values);
    }

    /*********************
     * Private Functions *
     *********************/

    function _getCurrent() internal view returns (Environment storage) {
        uint256 length = values.length;
        if (length == 1) {
            return values[0];
        }
        return values[length - 2];
    }

    function _getNext() internal view returns (Environment storage) {
        uint256 length = values.length;
        if (length == 1) {
            return values[0];
        }
        return values[length - 1];
    }

    function _updateValue(Environment memory _value) private {
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
