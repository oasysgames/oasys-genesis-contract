// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import { Constants } from "./Constants.sol";
import { IEnvironment } from "../IEnvironment.sol";

/**
 * @title EnvironmentValue
 */
library EnvironmentValue {
    function epoch(IEnvironment.EnvironmentValue storage value) internal view returns (uint256) {
        return value.startEpoch + (block.number - value.startBlock) / value.epochPeriod;
    }

    function nextStartBlock(IEnvironment.EnvironmentValue storage value, IEnvironment.EnvironmentValue memory newValue)
        internal
        view
        returns (uint256)
    {
        return value.startBlock + (newValue.startEpoch - value.startEpoch) * value.epochPeriod;
    }

    function started(IEnvironment.EnvironmentValue storage value, uint256 _block) internal view returns (bool) {
        return _block >= value.startBlock;
    }

    function validate(IEnvironment.EnvironmentValue memory value) internal pure {
        require(value.blockPeriod >= 1, "blockPeriod is too small.");
        require(value.epochPeriod >= 3, "epochPeriod is too small.");
        require(value.rewardRate <= Constants.MAX_REWARD_RATE, "rewardRate is too large.");
        require(value.validatorThreshold >= 1, "validatorThreshold is too small.");
        require(value.jailThreshold >= 1, "jailThreshold is too small.");
        require(value.jailPeriod >= 1, "jailPeriod is too small.");
    }
}
