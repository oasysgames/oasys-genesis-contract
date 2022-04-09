// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import { Constants } from "./lib/Common.sol";

abstract contract IEnvironment {
    struct Environment {
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

    function epoch() public view virtual returns (uint256);

    function isFirstBlock() public view virtual returns (bool);

    function isLastBlock() public view virtual returns (bool);

    function value() public view virtual returns (Environment memory);

    function epochAndValues() public view virtual returns (uint256[] memory epochs, Environment[] memory _values);
}

library EnvironmentLib {
    function epoch(IEnvironment.Environment storage value) internal view returns (uint256) {
        return value.startEpoch + (block.number - value.startBlock) / value.epochPeriod;
    }

    function nextStartBlock(IEnvironment.Environment storage value, IEnvironment.Environment memory newValue)
        internal
        view
        returns (uint256)
    {
        return value.startBlock + (newValue.startEpoch - value.startEpoch) * value.epochPeriod;
    }

    function started(IEnvironment.Environment storage value, uint256 _block) internal view returns (bool) {
        return _block >= value.startBlock;
    }

    function validate(IEnvironment.Environment memory value) internal pure {
        require(value.blockPeriod >= 1, "blockPeriod is too small.");
        require(value.epochPeriod >= 3, "epochPeriod is too small.");
        require(value.rewardRate <= Constants.MAX_REWARD_RATE, "rewardRate is too large.");
        require(value.validatorThreshold >= 1, "validatorThreshold is too small.");
        require(value.jailThreshold >= 1, "jailThreshold is too small.");
        require(value.jailPeriod >= 1, "jailPeriod is too small.");
    }
}
