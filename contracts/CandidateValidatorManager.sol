// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import { ICandidateValidatorManager } from "./ICandidateValidatorManager.sol";
import { IEnvironment } from "./IEnvironment.sol";
import { IStakeManager } from "./IStakeManager.sol";
import { IAddressList } from "./lib/IAddressList.sol";
import { NullAddress, UnauthorizedSender, PastEpoch } from "./lib/Errors.sol";

/**
 * @title CandidateValidatorManager
 * @dev A contract that manages candidate validators.
 */
contract CandidateValidatorManager is ICandidateValidatorManager {
    /*************
     * Constants *
     *************/

    IEnvironment public immutable environment;
    IStakeManager public immutable stakeManager;
    IAddressList public immutable highStakes;

    /***************
     * Constructor *
     ***************/

    /**
     * @param _environment Address of the Environment contract.
     * @param _stakeManager Address of the StakeManager contract.
     * @param _highStakes Address of the AddressList contract.
     */
    constructor(address _environment, address _stakeManager, address _highStakes) {
        if (_environment == address(0)) revert NullAddress();
        if (_stakeManager == address(0)) revert NullAddress();
        if (_highStakes == address(0)) revert NullAddress();

        environment = IEnvironment(_environment);
        stakeManager = IStakeManager(_stakeManager);
        highStakes = IAddressList(_highStakes);
    }

    /********************
     * Public functions *
     ********************/

    /**
     * @inheritdoc ICandidateValidatorManager
     */
    function afterStakeUpdate(address validator) external {
        if (msg.sender != address(stakeManager)) revert UnauthorizedSender();
        if (validator == address(0)) revert NullAddress();

        _updateHighStakes(validator);
    }

    /**
     * @inheritdoc ICandidateValidatorManager
     */
    function getAll(
        uint256 epoch,
        uint256 cursor,
        uint256 howMany
    )
        external
        view
        returns (
            address[] memory owners,
            address[] memory operators,
            bool[] memory actives,
            bool[] memory jailed,
            uint256[] memory stakes,
            bool[] memory candidates,
            uint256 newCursor
        )
    {
        if (epoch == 0) epoch = environment.epoch();
        (owners, newCursor) = stakeManager.getValidatorOwners(cursor, howMany);
        (operators, actives, jailed, stakes, candidates) = _getValidatorInfos(owners, epoch);
    }

    /**
     * @inheritdoc ICandidateValidatorManager
     */
    function getHighStakes(
        uint256 epoch,
        uint256 cursor,
        uint256 howMany
    )
        external
        view
        returns (
            address[] memory owners,
            address[] memory operators,
            bool[] memory actives,
            bool[] memory jailed,
            uint256[] memory stakes,
            bool[] memory candidates,
            uint256 newCursor
        )
    {
        if (epoch < environment.epoch()) revert PastEpoch();

        (owners, newCursor) = highStakes.list(cursor, howMany);
        (operators, actives, jailed, stakes, candidates) = _getValidatorInfos(owners, epoch);
    }

    /*********************
     * Private functions *
     *********************/

    /**
     * If the staking amount for the current or next epoch
     * is above the threshold, add the address to list.
     * If the staking amount for the current and next epoch
     * is below the threshold, remove the address from list.
     */
    function _updateHighStakes(address validator) internal {
        uint256 currEpoch = environment.epoch();
        uint256 nextEpoch = currEpoch + 1;

        uint256 currThreshold = environment.findValue(currEpoch).validatorThreshold;
        uint256 nextThreshold = environment.findValue(nextEpoch).validatorThreshold;

        address[3] memory _validators = [
            validator,
            // also check adjacent validators
            highStakes.prev(validator),
            highStakes.next(validator)
        ];

        for (uint8 i = 0; i < 3; i++) {
            address x = _validators[i];
            if (x == address(0)) continue;

            // check if the current epoch stake is above the threshold
            bool enoughCurr = stakeManager.getValidatorStakes(x, currEpoch) >= currThreshold;

            // check if the next epoch stake is above the threshold
            bool enoughNext = stakeManager.getValidatorStakes(x, nextEpoch) >= nextThreshold;

            if (enoughCurr || enoughNext) {
                highStakes.add(x);
            } else if (!enoughCurr && !enoughNext) {
                highStakes.remove(x);
            }
        }
    }

    function _getValidatorInfos(
        address[] memory owners,
        uint256 epoch
    )
        internal
        view
        returns (
            address[] memory operators,
            bool[] memory actives,
            bool[] memory jailed,
            uint256[] memory stakes,
            bool[] memory candidates
        )
    {
        uint256 length = owners.length;
        operators = new address[](length);
        actives = new bool[](length);
        jailed = new bool[](length);
        stakes = new uint256[](length);
        candidates = new bool[](length);

        for (uint256 i = 0; i < length; i++) {
            (operators[i], actives[i], jailed[i], candidates[i], stakes[i]) = stakeManager.getValidatorInfo(
                owners[i],
                epoch
            );
        }
    }
}
