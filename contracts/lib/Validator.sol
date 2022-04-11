// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import { Environment } from "../Environment.sol";
import { StakeManager } from "../StakeManager.sol";
import { Constants } from "./Constants.sol";
import { Math } from "./Math.sol";
import { UpdateHistories } from "./UpdateHistories.sol";

/**
 * @title Validator
 */
library Validator {
    using UpdateHistories for uint256[];

    /********************
     * Public Functions *
     ********************/

    function join(StakeManager.Validator storage validator, address operator) internal {
        require(validator.owner == address(0), "already joined.");

        validator.owner = msg.sender;
        validator.active = true;
        updateOperator(validator, operator);
    }

    function updateOperator(StakeManager.Validator storage validator, address operator) internal {
        require(operator != address(0), "operator is zero address.");
        require(operator != validator.owner, "operator is same as owner.");

        validator.operator = operator;
    }

    function activate(StakeManager.Validator storage validator) internal {
        validator.active = true;
    }

    function deactivate(StakeManager.Validator storage validator) internal {
        validator.active = false;
    }

    function updateCommissionRate(
        StakeManager.Validator storage validator,
        Environment environment,
        uint256 newRate
    ) internal {
        require(newRate <= Constants.MAX_COMMISSION_RATE, "must be less than 100.");
        validator.lastCommissionUpdates.set(validator.commissionRates, environment.epoch() + 1, newRate);
    }

    function stake(
        StakeManager.Validator storage validator,
        Environment environment,
        address staker,
        uint256 amount
    ) internal {
        if (!validator.stakerExists[staker]) {
            validator.stakerExists[staker] = true;
            validator.stakers.push(staker);
        }
        validator.stakeUpdates.add(validator.stakeAmounts, environment.epoch() + 1, amount);
    }

    function unstake(
        StakeManager.Validator storage validator,
        Environment environment,
        uint256 amount
    ) internal {
        validator.stakeUpdates.sub(validator.stakeAmounts, environment.epoch() + 1, amount);
    }

    function claimCommissions(
        StakeManager.Validator storage validator,
        Environment environment,
        uint256 epochs
    ) internal {
        (uint256 commissions, uint256 lastClaim) = getCommissions(validator, environment, epochs);
        validator.lastClaimCommission = lastClaim;
        if (commissions > 0) {
            payable(validator.owner).transfer(commissions);
        }
    }

    function slash(StakeManager.Validator storage validator, Environment environment) internal {
        validator.slashes[environment.epoch()] += 1;
    }

    /******************
     * View Functions *
     ******************/

    function isCandidates(StakeManager.Validator storage validator, Environment environment)
        internal
        view
        returns (bool)
    {
        if (!validator.active) return false;

        Environment.EnvironmentValue memory env = environment.value();
        uint256 epoch = environment.epoch();
        if (validator.jailEpoch > 0 && epoch - validator.jailEpoch < env.jailPeriod) return false;
        if (getTotalStake(validator, epoch + 1) < env.validatorThreshold) return false;
        return true;
    }

    function getCommissionRate(StakeManager.Validator storage validator, uint256 epoch)
        internal
        view
        returns (uint256)
    {
        return validator.lastCommissionUpdates.find(validator.commissionRates, epoch);
    }

    function getTotalStake(StakeManager.Validator storage validator, uint256 epoch) internal view returns (uint256) {
        return validator.stakeUpdates.find(validator.stakeAmounts, epoch);
    }

    function getRewards(
        StakeManager.Validator storage validator,
        Environment.EnvironmentValue memory env,
        uint256 epoch
    ) internal view returns (uint256) {
        uint256 _stake = getTotalStake(validator, epoch);
        if (_stake == 0) return 0;

        uint256 blocks = validator.blocks[epoch];
        uint256 slashes = validator.slashes[epoch];
        if (blocks == 0 || slashes >= blocks) return 0;

        uint256 rewards = (_stake *
            Math.percent(env.rewardRate, Constants.MAX_REWARD_RATE, Constants.REWARD_PRECISION)) /
            10**Constants.REWARD_PRECISION;
        if (rewards == 0) return 0;

        rewards *= Math.percent(
            env.blockPeriod * env.epochPeriod,
            Constants.SECONDS_PER_YEAR,
            Constants.REWARD_PRECISION
        );
        rewards /= 10**Constants.REWARD_PRECISION;
        return Math.share(rewards, blocks - slashes, blocks, Constants.REWARD_PRECISION);
    }

    function getRewardsWithoutCommissions(
        StakeManager.Validator storage validator,
        Environment.EnvironmentValue memory env,
        uint256 epoch
    ) internal view returns (uint256) {
        uint256 rewards = getRewards(validator, env, epoch);
        if (rewards == 0) return 0;

        uint256 commissionRate = getCommissionRate(validator, epoch);
        if (commissionRate == 0) return rewards;

        return rewards - Math.share(rewards, commissionRate, Constants.MAX_COMMISSION_RATE, Constants.REWARD_PRECISION);
    }

    function getCommissions(
        StakeManager.Validator storage validator,
        Environment environment,
        uint256 epochs
    ) internal view returns (uint256 commissions, uint256 lastClaim) {
        lastClaim = validator.lastClaimCommission;
        uint256 prevEpoch = environment.epoch() - 1;
        if (epochs == 0 || epochs + lastClaim > prevEpoch) {
            epochs = prevEpoch - lastClaim;
        }

        (uint256[] memory envUpdates, Environment.EnvironmentValue[] memory envValues) = environment.epochAndValues();

        for (uint256 i = 0; i < epochs; i++) {
            lastClaim += 1;

            uint256 rewards = getRewards(validator, envUpdates.find(envValues, lastClaim), lastClaim);
            if (rewards == 0) continue;

            uint256 commissionRate = getCommissionRate(validator, lastClaim);
            if (commissionRate == 0) continue;

            commissions += Math.share(
                rewards,
                commissionRate,
                Constants.MAX_COMMISSION_RATE,
                Constants.REWARD_PRECISION
            );
        }
    }

    function getBlockAndSlashes(StakeManager.Validator storage validator, uint256 epoch)
        internal
        view
        returns (uint256, uint256)
    {
        return (validator.blocks[epoch], validator.slashes[epoch]);
    }
}
