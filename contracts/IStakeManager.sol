// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import { IEnvironment } from "./IEnvironment.sol";
import { Constants, MathLib, UpdateHistoriesLib } from "./lib/Common.sol";

abstract contract IStakeManager {
    struct Validator {
        address owner;
        address operator;
        bool active;
        uint256 jailEpoch;
        // Commission rate last updated epoch
        uint256[] lastCommissionUpdates;
        // Commission rates per epoch
        uint256[] commissionRates;
        // Stake last updated epoch
        uint256[] stakeUpdates;
        // Stake amounts per epoch
        uint256[] stakeAmounts;
        // Epoch of last claimed of commissions
        uint256 lastClaimCommission;
        // List of stakers
        address[] stakers;
        mapping(address => bool) stakerExists;
        // List of epochs joined in creation of block
        uint256[] epochs;
        // Expected number of block createds per epoch
        mapping(uint256 => uint256) blocks;
        // Number of slashes per epoch
        mapping(uint256 => uint256) slashes;
    }

    struct Staker {
        address signer;
        // Stake last updated epoch
        mapping(address => uint256[]) stakeUpdates;
        // Stake amounts per epoch
        mapping(address => uint256[]) stakeAmounts;
        // Last epoch to withdrawl unstake
        uint256[] unstakeUpdates;
        // Unstake amounts per epoch
        uint256[] unstakeAmounts;
        // Epoch of last claimed of rewards per validator
        mapping(address => uint256) lastClaimReward;
    }

    function getCurrentValidators()
        external
        view
        virtual
        returns (
            address[] memory owners,
            address[] memory operators,
            uint256[] memory stakes
        );
}

library ValidatorLib {
    using UpdateHistoriesLib for uint256[];

    /********************
     * Public Functions *
     ********************/

    function join(IStakeManager.Validator storage validator, address operator) internal {
        require(validator.owner == address(0), "already joined.");

        validator.owner = msg.sender;
        validator.active = true;
        updateOperator(validator, operator);
    }

    function updateOperator(IStakeManager.Validator storage validator, address operator) internal {
        require(operator != address(0), "operator is zero address.");
        require(operator != validator.owner, "operator is same as owner.");

        validator.operator = operator;
    }

    function activate(IStakeManager.Validator storage validator) internal {
        validator.active = true;
    }

    function deactivate(IStakeManager.Validator storage validator) internal {
        validator.active = false;
    }

    function updateCommissionRate(
        IStakeManager.Validator storage validator,
        IEnvironment environment,
        uint256 newRate
    ) internal {
        require(newRate <= Constants.MAX_COMMISSION_RATE, "must be less than 100.");
        validator.lastCommissionUpdates.set(validator.commissionRates, environment.epoch() + 1, newRate);
    }

    function stake(
        IStakeManager.Validator storage validator,
        IEnvironment environment,
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
    ) internal {
        (uint256 commissions, uint256 lastClaim) = getCommissions(validator, environment, epochs);
        validator.lastClaimCommission = lastClaim;
        if (commissions > 0) {
            payable(validator.owner).transfer(commissions);
        }
    }

    function slash(IStakeManager.Validator storage validator, IEnvironment environment) internal {
        validator.slashes[environment.epoch()] += 1;
    }

    /******************
     * View Functions *
     ******************/

    function isCandidates(IStakeManager.Validator storage validator, IEnvironment environment)
        internal
        view
        returns (bool)
    {
        if (!validator.active) return false;

        IEnvironment.Environment memory env = environment.value();
        uint256 epoch = environment.epoch();
        if (validator.jailEpoch > 0 && epoch - validator.jailEpoch < env.jailPeriod) return false;
        if (getTotalStake(validator, epoch + 1) < env.validatorThreshold) return false;
        return true;
    }

    function getCommissionRate(IStakeManager.Validator storage validator, uint256 epoch)
        internal
        view
        returns (uint256)
    {
        return validator.lastCommissionUpdates.find(validator.commissionRates, epoch);
    }

    function getTotalStake(IStakeManager.Validator storage validator, uint256 epoch) internal view returns (uint256) {
        return validator.stakeUpdates.find(validator.stakeAmounts, epoch);
    }

    function getRewards(
        IStakeManager.Validator storage validator,
        IEnvironment.Environment memory env,
        uint256 epoch
    ) internal view returns (uint256) {
        uint256 _stake = getTotalStake(validator, epoch);
        if (_stake == 0) return 0;

        uint256 blocks = validator.blocks[epoch];
        uint256 slashes = validator.slashes[epoch];
        if (blocks == 0 || slashes >= blocks) return 0;

        uint256 rewards = (_stake *
            MathLib.percent(env.rewardRate, Constants.MAX_REWARD_RATE, Constants.REWARD_PRECISION)) /
            10**Constants.REWARD_PRECISION;
        if (rewards == 0) return 0;

        rewards *= MathLib.percent(
            env.blockPeriod * env.epochPeriod,
            Constants.SECONDS_PER_YEAR,
            Constants.REWARD_PRECISION
        );
        rewards /= 10**Constants.REWARD_PRECISION;
        return MathLib.share(rewards, blocks - slashes, blocks, Constants.REWARD_PRECISION);
    }

    function getRewardsWithoutCommissions(
        IStakeManager.Validator storage validator,
        IEnvironment.Environment memory env,
        uint256 epoch
    ) internal view returns (uint256) {
        uint256 rewards = getRewards(validator, env, epoch);
        if (rewards == 0) return 0;

        uint256 commissionRate = getCommissionRate(validator, epoch);
        if (commissionRate == 0) return rewards;

        return
            rewards - MathLib.share(rewards, commissionRate, Constants.MAX_COMMISSION_RATE, Constants.REWARD_PRECISION);
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

        (uint256[] memory envUpdates, IEnvironment.Environment[] memory envValues) = environment.epochAndValues();

        for (uint256 i = 0; i < epochs; i++) {
            lastClaim += 1;

            uint256 rewards = getRewards(validator, envUpdates.find(envValues, lastClaim), lastClaim);
            if (rewards == 0) continue;

            uint256 commissionRate = getCommissionRate(validator, lastClaim);
            if (commissionRate == 0) continue;

            commissions += MathLib.share(
                rewards,
                commissionRate,
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
}

library StakerLib {
    using UpdateHistoriesLib for uint256[];
    using ValidatorLib for IStakeManager.Validator;

    /********************
     * Public Functions *
     ********************/

    function stake(
        IStakeManager.Staker storage staker,
        IEnvironment environment,
        IStakeManager.Validator storage validator,
        uint256 amount
    ) internal {
        staker.stakeUpdates[validator.owner].add(staker.stakeAmounts[validator.owner], environment.epoch() + 1, amount);
        validator.stake(environment, staker.signer, amount);
    }

    function unstake(
        IStakeManager.Staker storage staker,
        IEnvironment environment,
        IStakeManager.Validator storage validator,
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
        IStakeManager.Staker storage staker,
        IEnvironment environment,
        IStakeManager.Validator storage validator,
        uint256 epochs
    ) internal {
        (uint256 rewards, uint256 lastClaim) = getRewards(staker, environment, validator, epochs);
        staker.lastClaimReward[validator.owner] = lastClaim;
        if (rewards > 0) {
            payable(staker.signer).transfer(rewards);
        }
    }

    function claimUnstakes(IStakeManager.Staker storage staker, IEnvironment environment) internal {
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
        IStakeManager.Staker storage staker,
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
        IStakeManager.Staker storage staker,
        address validator,
        uint256 epoch
    ) internal view returns (uint256) {
        return staker.stakeUpdates[validator].find(staker.stakeAmounts[validator], epoch);
    }

    function getTotalStake(
        IStakeManager.Staker storage staker,
        address[] storage validators,
        uint256 epoch
    ) internal view returns (uint256 totalStake) {
        for (uint256 i = 0; i < validators.length; i++) {
            totalStake += getStake(staker, validators[i], epoch);
        }
    }

    function getRewards(
        IStakeManager.Staker storage staker,
        IEnvironment environment,
        IStakeManager.Validator storage validator,
        uint256 epochs
    ) internal view returns (uint256 rewards, uint256 lastClaim) {
        lastClaim = staker.lastClaimReward[validator.owner];
        uint256 prevEpoch = environment.epoch() - 1;
        if (epochs == 0 || epochs + lastClaim > prevEpoch) {
            epochs = prevEpoch - lastClaim;
        }

        (uint256[] memory envUpdates, IEnvironment.Environment[] memory envValues) = environment.epochAndValues();

        for (uint256 i = 0; i < epochs; i++) {
            lastClaim += 1;

            uint256 _stake = getStake(staker, validator.owner, lastClaim);
            if (_stake == 0) continue;

            uint256 validatorRewards = validator.getRewardsWithoutCommissions(
                envUpdates.find(envValues, lastClaim),
                lastClaim
            );
            if (validatorRewards == 0) continue;

            rewards += MathLib.share(
                validatorRewards,
                _stake,
                validator.getTotalStake(lastClaim),
                Constants.REWARD_PRECISION
            );
        }
    }

    function getUnstakes(IStakeManager.Staker storage staker, IEnvironment environment)
        internal
        view
        returns (uint256)
    {
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
        IStakeManager.Staker storage staker,
        IEnvironment environment,
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
