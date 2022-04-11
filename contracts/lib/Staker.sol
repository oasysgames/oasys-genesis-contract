// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import { Environment } from "../Environment.sol";
import { StakeManager } from "../StakeManager.sol";
import { Constants } from "./Constants.sol";
import { Math } from "./Math.sol";
import { UpdateHistories } from "./UpdateHistories.sol";
import { Validator as ValidatorLib } from "./Validator.sol";

/**
 * @title Staker
 */
library Staker {
    using UpdateHistories for uint256[];
    using ValidatorLib for StakeManager.Validator;

    /********************
     * Public Functions *
     ********************/

    function stake(
        StakeManager.Staker storage staker,
        Environment environment,
        StakeManager.Validator storage validator,
        uint256 amount
    ) internal {
        staker.stakeUpdates[validator.owner].add(staker.stakeAmounts[validator.owner], environment.epoch() + 1, amount);
        validator.stake(environment, staker.signer, amount);
    }

    function unstake(
        StakeManager.Staker storage staker,
        Environment environment,
        StakeManager.Validator storage validator,
        uint256 amount
    ) internal returns (uint256) {
        uint256 epoch = environment.epoch();
        uint256 current = getStake(staker, validator.owner, epoch);
        uint256 next = getStake(staker, validator.owner, epoch + 1);

        amount = staker.stakeUpdates[validator.owner].sub(staker.stakeAmounts[validator.owner], epoch + 1, amount);
        if (amount == 0) return 0;
        validator.unstake(environment, amount);

        uint256 unstakes = amount;
        uint256 refunds;
        if (next > current) {
            refunds = next - current;
            refunds = amount < refunds ? amount : refunds;
            unstakes -= refunds;
        }
        if (unstakes > 0) {
            _addUnstakeAmount(staker, environment, unstakes);
        }
        if (refunds > 0) {
            payable(staker.signer).transfer(refunds);
        }
        return amount;
    }

    function claimRewards(
        StakeManager.Staker storage staker,
        Environment environment,
        StakeManager.Validator storage validator,
        uint256 epochs
    ) internal {
        (uint256 rewards, uint256 lastClaim) = getRewards(staker, environment, validator, epochs);
        staker.lastClaimReward[validator.owner] = lastClaim;
        if (rewards > 0) {
            payable(staker.signer).transfer(rewards);
        }
    }

    function claimUnstakes(StakeManager.Staker storage staker, Environment environment) internal {
        uint256 unstakes = getUnstakes(staker, environment);
        if (unstakes == 0) return;

        uint256 length = staker.unstakeUpdates.length;
        if (staker.unstakeUpdates[length - 1] <= environment.epoch()) {
            delete staker.unstakeUpdates;
            delete staker.unstakeAmounts;
        } else {
            staker.unstakeUpdates = [staker.unstakeUpdates[length - 1]];
            staker.unstakeAmounts = [staker.unstakeAmounts[length - 1]];
        }

        payable(staker.signer).transfer(unstakes);
    }

    /******************
     * View Functions *
     ******************/

    function getStakes(
        StakeManager.Staker storage staker,
        address[] storage _validators,
        uint256 epoch
    )
        internal
        view
        returns (
            uint256[] memory currents,
            uint256[] memory stakes,
            uint256[] memory unstakes
        )
    {
        currents = new uint256[](_validators.length);
        stakes = new uint256[](_validators.length);
        unstakes = new uint256[](_validators.length);
        for (uint256 i = 0; i < _validators.length; i++) {
            uint256 current = getStake(staker, _validators[i], epoch);
            uint256 next = getStake(staker, _validators[i], epoch + 1);
            currents[i] = current;
            if (next > current) {
                stakes[i] = next - current;
            } else if (next < current) {
                unstakes[i] = current - next;
            }
        }
    }

    function getStake(
        StakeManager.Staker storage staker,
        address validator,
        uint256 epoch
    ) internal view returns (uint256) {
        return staker.stakeUpdates[validator].find(staker.stakeAmounts[validator], epoch);
    }

    function getTotalStake(
        StakeManager.Staker storage staker,
        address[] storage validators,
        uint256 epoch
    ) internal view returns (uint256 totalStake) {
        for (uint256 i = 0; i < validators.length; i++) {
            totalStake += getStake(staker, validators[i], epoch);
        }
    }

    function getRewards(
        StakeManager.Staker storage staker,
        Environment environment,
        StakeManager.Validator storage validator,
        uint256 epochs
    ) internal view returns (uint256 rewards, uint256 lastClaim) {
        lastClaim = staker.lastClaimReward[validator.owner];
        uint256 prevEpoch = environment.epoch() - 1;
        if (epochs == 0 || epochs + lastClaim > prevEpoch) {
            epochs = prevEpoch - lastClaim;
        }

        (uint256[] memory envUpdates, Environment.EnvironmentValue[] memory envValues) = environment.epochAndValues();

        for (uint256 i = 0; i < epochs; i++) {
            lastClaim += 1;

            uint256 _stake = getStake(staker, validator.owner, lastClaim);
            if (_stake == 0) continue;

            uint256 validatorRewards = validator.getRewardsWithoutCommissions(
                envUpdates.find(envValues, lastClaim),
                lastClaim
            );
            if (validatorRewards == 0) continue;

            rewards += Math.share(
                validatorRewards,
                _stake,
                validator.getTotalStake(lastClaim),
                Constants.REWARD_PRECISION
            );
        }
    }

    function getUnstakes(StakeManager.Staker storage staker, Environment environment) internal view returns (uint256) {
        uint256 length = staker.unstakeUpdates.length;
        if (length == 0) return 0;

        uint256 epoch = environment.epoch();
        uint256 idx = length - 1;
        if (idx > 0 && staker.unstakeUpdates[idx] > epoch) {
            idx--;
        }
        if (staker.unstakeUpdates[idx] > epoch) return 0;

        uint256 unstakes;
        for (uint256 i = 0; i <= idx; i++) {
            unstakes += staker.unstakeAmounts[i];
        }
        return unstakes;
    }

    /*********************
     * Private Functions *
     *********************/

    function _addUnstakeAmount(
        StakeManager.Staker storage staker,
        Environment environment,
        uint256 amount
    ) private {
        uint256 nextEpoch = environment.epoch() + 1;
        uint256 length = staker.unstakeUpdates.length;

        if (length == 0 || staker.unstakeUpdates[length - 1] != nextEpoch) {
            staker.unstakeUpdates.push(nextEpoch);
            staker.unstakeAmounts.push(amount);
            return;
        }
        staker.unstakeAmounts[length - 1] += amount;
    }
}
