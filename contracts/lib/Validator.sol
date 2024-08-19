// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import { Constants } from "./Constants.sol";
import { Math } from "./Math.sol";
import { UpdateHistories } from "./UpdateHistories.sol";
import { Token } from "./Token.sol";
import { IEnvironment } from "../IEnvironment.sol";
import { IStakeManager } from "../IStakeManager.sol";

// Validator is already joined.
error AlreadyJoined();

// Operator is zero address.
error EmptyAddress();

// Operator is same as owner.
error SameAsOwner();

// Commission rate is too large.
error OverRate();

// BLS public key length is invalid.
error InvalidBLSLength();

// BLS public key is empty.
error EmptyBLS();

/**
 * @title Validator
 */
library Validator {
    using UpdateHistories for uint256[];

    /********************
     * Public Functions *
     ********************/

    function join(IStakeManager.Validator storage validator, address operator) internal {
        if (validator.owner != address(0)) revert AlreadyJoined();

        validator.owner = msg.sender;
        updateOperator(validator, operator);
    }

    function updateOperator(IStakeManager.Validator storage validator, address operator) internal {
        if (operator == address(0)) revert EmptyAddress();
        if (operator == validator.owner) revert SameAsOwner();

        validator.operator = operator;
    }

    function updateBLSPublicKey(IStakeManager.Validator storage validator, bytes calldata blsPublicKey) internal {
        if (blsPublicKey.length != 48) revert InvalidBLSLength();
        // verify not empty
        if (
            uint256(bytes32(blsPublicKey[0:32])) == 0 &&
            uint128(bytes16(blsPublicKey[32:48])) == 0
        ) {
            revert EmptyBLS();
        }

        validator.blsPublicKey = blsPublicKey;
    }

    function activate(
        IStakeManager.Validator storage validator,
        uint256 epoch,
        uint256[] memory epochs
    ) internal {
        _updateInactives(validator, epoch, epochs, false);
    }

    function deactivate(
        IStakeManager.Validator storage validator,
        uint256 epoch,
        uint256[] memory epochs
    ) internal {
        _updateInactives(validator, epoch, epochs, true);
    }

    function stake(
        IStakeManager.Validator storage validator,
        uint256 epoch,
        address staker,
        uint256 amount
    ) internal {
        if (!validator.stakerExists[staker]) {
            validator.stakerExists[staker] = true;
            validator.stakers.push(staker);
        }
        validator.stakeUpdates.add(validator.stakeAmounts, epoch, amount);
    }

    function unstake(
        IStakeManager.Validator storage validator,
        IEnvironment environment,
        uint256 amount
    ) internal {
        validator.stakeUpdates.sub(validator.stakeAmounts, environment.epoch() + 1, amount);
    }

    function claimCommissions(
        IStakeManager.Validator storage validator,
        IEnvironment environment,
        uint256 epochs
    ) internal returns (uint256) {
        (uint256 commissions, uint256 lastClaim) = getCommissions(validator, environment, epochs);
        validator.lastClaimCommission = lastClaim;
        return commissions;
    }

    function slash(
        IStakeManager.Validator storage validator,
        IEnvironment.EnvironmentValue memory env,
        uint256 epoch,
        uint256 blocks
    ) internal returns (uint256 until) {
        if (validator.blocks[epoch] == 0) {
            validator.blocks[epoch] = blocks;
        }

        uint256 slashes = validator.slashes[epoch] + 1;
        validator.slashes[epoch] = slashes;
        if (slashes >= env.jailThreshold && !validator.jails[epoch + 1]) {
            until = epoch + env.jailPeriod;
            while (epoch < until) {
                epoch++;
                validator.jails[epoch] = true;
            }
        }
    }

    /******************
     * View Functions *
     ******************/

    function isJailed(IStakeManager.Validator storage validator, uint256 epoch) internal view returns (bool) {
        return validator.jails[epoch];
    }

    function isInactive(IStakeManager.Validator storage validator, uint256 epoch) internal view returns (bool) {
        return validator.inactives[epoch];
    }

    function getTotalStake(IStakeManager.Validator storage validator, uint256 epoch) internal view returns (uint256) {
        return validator.stakeUpdates.find(validator.stakeAmounts, epoch);
    }

    function getRewards(
        IStakeManager.Validator storage validator,
        IEnvironment.EnvironmentValue memory env,
        uint256 epoch
    ) internal view returns (uint256 rewards, uint256 totalStake) {
        if (isInactive(validator, epoch) || isJailed(validator, epoch)) return (0, 0);

        totalStake = getTotalStake(validator, epoch);

        if (epoch >= 73) {
            if (totalStake < env.validatorThreshold) return (0, totalStake);
            rewards = (totalStake * 2612) / 1e7;
        } else {
            if (totalStake == 0) return (0, 0);

            rewards =
                (totalStake * Math.percent(env.rewardRate, Constants.MAX_REWARD_RATE, Constants.REWARD_PRECISION)) /
                10**Constants.REWARD_PRECISION;
            if (rewards == 0) return (0, totalStake);

            rewards *= Math.percent(
                env.blockPeriod * env.epochPeriod,
                Constants.SECONDS_PER_YEAR,
                Constants.REWARD_PRECISION
            );
            rewards /= 10**Constants.REWARD_PRECISION;
        }

        uint256 slashes = validator.slashes[epoch];
        if (slashes > 0) {
            uint256 blocks = validator.blocks[epoch];
            rewards = Math.share(rewards, blocks - slashes, blocks, Constants.REWARD_PRECISION);
        }
        return (rewards, totalStake);
    }

    function getRewardsWithoutCommissions(
        IStakeManager.Validator storage validator,
        IEnvironment.EnvironmentValue memory env,
        uint256 epoch
    ) internal view returns (uint256 rewards, uint256 totalStake) {
        (rewards, totalStake) = getRewards(validator, env, epoch);
        if (rewards == 0) return (0, totalStake);

        if (env.commissionRate > 0) {
            rewards -= Math.share(
                rewards,
                env.commissionRate,
                Constants.MAX_COMMISSION_RATE,
                Constants.REWARD_PRECISION
            );
        }
        return (rewards, totalStake);
    }

    function getCommissions(
        IStakeManager.Validator storage validator,
        IEnvironment environment,
        uint256 epochs
    ) internal view returns (uint256 commissions, uint256 lastClaim) {
        lastClaim = validator.lastClaimCommission;
        uint256 prevEpoch = environment.epoch() - 1;
        if (epochs == 0 || epochs + lastClaim > prevEpoch) {
            epochs = prevEpoch - lastClaim;
        }

        for (uint256 i = 0; i < epochs; i++) {
            lastClaim += 1;
            IEnvironment.EnvironmentValue memory env = environment.findValue(lastClaim);

            (uint256 rewards, ) = getRewards(validator, env, lastClaim);
            if (rewards == 0) continue;

            if (env.commissionRate == 0) continue;

            commissions += Math.share(
                rewards,
                env.commissionRate,
                Constants.MAX_COMMISSION_RATE,
                Constants.REWARD_PRECISION
            );
        }
    }

    function getBlockAndSlashes(IStakeManager.Validator storage validator, uint256 epoch)
        internal
        view
        returns (uint256, uint256)
    {
        return (validator.blocks[epoch], validator.slashes[epoch]);
    }

    /*********************
     * Private Functions *
     *********************/

    function _updateInactives(
        IStakeManager.Validator storage validator,
        uint256 epoch,
        uint256[] memory epochs,
        bool status
    ) private {
        uint256 length = epochs.length;
        for (uint256 i = 0; i < length; i++) {
            uint256 _epoch = epochs[i];
            if (_epoch > epoch && validator.inactives[_epoch] != status) {
                validator.inactives[_epoch] = status;
            }
        }
    }
}
