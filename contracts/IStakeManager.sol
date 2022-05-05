// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import { IEnvironment } from "./IEnvironment.sol";
import { Token } from "./lib/Token.sol";
import { IAllowlist } from "./lib/IAllowlist.sol";

/**
 * @title IStakeManager
 */
interface IStakeManager {
    /**********
     * Events *
     **********/

    event ValidatorActivated(address indexed validator);
    event ValidatorDeactivated(address indexed validator);
    event ValidatorCommissionRateUpdated(address indexed validator, uint256 rate);
    event ValidatorSlashed(address indexed validator);
    event ValidatorJailed(address indexed validator, uint256 epoch);
    event Staked(address indexed staker, address indexed validator, Token.Type token, uint256 amount);
    event Unstaked(address indexed staker, address indexed validator, Token.Type token, uint256 amount);

    /***********
     * Structs *
     ***********/

    struct Validator {
        // Validator address
        address owner;
        // Address used for block signing
        address operator;
        // Validator status
        bool active;
        // Epoch number at which the validator was jailed
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
        // Staker address
        address signer;
        // Stake last updated epoch
        mapping(Token.Type => mapping(address => uint256[])) stakeUpdates;
        // Stake amounts per epoch
        mapping(Token.Type => mapping(address => uint256[])) stakeAmounts;
        // Last epoch to withdrawl unstake
        mapping(Token.Type => uint256[]) unstakeUpdates;
        // Unstake amounts per epoch
        mapping(Token.Type => uint256[]) unstakeAmounts;
        // Epoch of last claimed of rewards per validator
        mapping(address => uint256) lastClaimReward;
    }

    /****************************
     * Functions for Validators *
     ****************************/

    /**
     * Initialization of contract.
     * This method is called by the genesis validator in the first epoch.
     * @param _environment Address of the Environment contract.
     */
    function initialize(IEnvironment _environment, IAllowlist _allowlist) external;

    /**
     * Record validators that failed to create blocks.
     * @param operator Validator address.
     */
    function slash(address operator) external;

    /**
     * Stores the number of blocks per validator should create at the current epoch.
     * The value is calculated by the validator that creates the first block of the epoch.
     * @param operators List of validator address.
     * @param counts List of blocks per validator.
     */
    function updateValidatorBlocks(address[] memory operators, uint256[] memory counts) external;

    /**
     * Select a validators for the next epoch based on current staking amounts and availability.
     * This method is called only once in the last block of the epoch.
     */
    function updateValidators() external;

    /*********************************************
     * Functions for Validator owner or operator *
     *********************************************/

    /**
     * Join as a validator in the proof-of-stake.
     * @param operator Address used for block signing.
     */
    function joinValidator(address operator) external;

    /**
     * Update the block signing address.
     * @param operator New address used for block signing.
     */
    function updateOperator(address operator) external;

    /**
     * Change the validator status to active.
     * Changes will be applied from next epoch.
     * @param validator Validator address.
     */
    function activateValidator(address validator) external;

    /**
     * Change the validator status to disable.
     * Changes will be applied from next epoch.
     * @param validator Validator address.
     */
    function deactivateValidator(address validator) external;

    /**
     * Update validator commission rates.
     * Changes will be applied from next epoch.
     * @param newRate New commission rates(0%~100%).
     */
    function updateCommissionRate(uint256 newRate) external;

    /**
     * Withdraw validator commissions.
     * Both owner and operator can be executed, but the remittance destination will be owner address.
     * @param validator Validator address.
     * @param epochs Number of epochs to be withdrawn.
     *     If zero is specified, all commissions from the last withdrawal to the present will be withdrawn.
     *     If the gas limit is reached, specify a smaller value.
     */
    function claimCommissions(address validator, uint256 epochs) external;

    /************************
     * Functions for Staker *
     ************************/

    /**
     * Stake tokens to validator.
     * The stakes will be effective from next epoch, so there is no reward in the current epoch.
     * @param validator Validator address.
     * @param token Type of token.
     * @param amount Amount of token.
     */
    function stake(
        address validator,
        Token.Type token,
        uint256 amount
    ) external payable;

    /**
     * Unstake tokens from validator.
     * The stake will be locked until the end of the current epoch, but will be rewarded.
     * @param validator Validator address.
     * @param token Type of token.
     * @param amount Unstake amounts.
     */
    function unstake(
        address validator,
        Token.Type token,
        uint256 amount
    ) external;

    /**
     * Withdraw staking rewards.
     * @param validator Validator address.
     * @param epochs Number of epochs to be withdrawn.
     *     If zero is specified, all rewards from the last withdrawal to the present will be withdrawn.
     *     If the gas limit is reached, specify a smaller value.
     */
    function claimRewards(address validator, uint256 epochs) external;

    /**
     * Withdraw unstaked tokens whose lock period has expired.
     */
    function claimUnstakes() external;

    /******************
     * View Functions *
     ******************/

    /**
     * Returns validators who create blocks in the current epoch.
     * @return owners List of addresses for block signing.
     * @return operators List of validator owner addresses.
     * @return stakes List of total staked amounts for each validator.
     */
    function getCurrentValidators()
        external
        view
        returns (
            address[] memory owners,
            address[] memory operators,
            uint256[] memory stakes
        );

    /**
     * Returns addresses of all validators.
     * @return List of validator address.
     */
    function getValidators() external view returns (address[] memory);

    /**
     * Returns staker addresses with pagination.
     * @param page Number of page.
     * @param perPage Number of addresses per page.
     * @return List of staker address.
     */
    function getStakers(uint256 page, uint256 perPage) external view returns (address[] memory);

    /**
     * Returns validator information.
     * @param validator Validator address.
     * @return operator Address used for block signing
     * @return active Validator status.
     * @return stakes Total staked amounts.
     * @return commissionRate Commission rates.
     * @return jailEpoch Last jailed epoch number.
     */
    function getValidatorInfo(address validator)
        external
        view
        returns (
            address operator,
            bool active,
            uint256 stakes,
            uint256 commissionRate,
            uint256 jailEpoch
        );

    /**
     * Returns staker information.
     * @param staker Staker address.
     * @param token Type of token.
     * @return stakes Total staked amounts.
     * @return unstakes Total unstaked amounts.
     */
    function getStakerInfo(address staker, Token.Type token) external view returns (uint256 stakes, uint256 unstakes);

    /**
     * Returns the balance of validator commissions.
     * @param validator Validator address.
     * @param epochs Number of epochs to be calculated.
     *     If zero is specified, all balances from the last withdrawal to the present will be calculated.
     *     If the gas limit is reached, specify a smaller value.
     * @return commissions Commission balance.
     */
    function getCommissions(address validator, uint256 epochs) external view returns (uint256 commissions);

    /**
     * Returns the balance of staking rewards.
     * @param staker Staker address.
     * @param validator Validator address.
     * @param epochs Number of epochs to be calculated.
     *     If zero is specified, all balances from the last withdrawal to the present will be calculated.
     *     If the gas limit is reached, specify a smaller value.
     * @return rewards Reward balance.
     */
    function getRewards(
        address staker,
        address validator,
        uint256 epochs
    ) external view returns (uint256 rewards);

    /**
     * Returns the total staking rewards for a given epoch period.
     * @param epochs Number of epochs to be calculated.
     * @return rewards Total staking rewards.
     */
    function getTotalRewards(uint256 epochs) external view returns (uint256 rewards);

    /**
     * Returns a list of stakers and amounts to the validator.
     * @param validator Validator address.
     * @param epoch Target epoch number.
     * @param page Number of page.
     * @param perPage Number of addresses per page.
     * @return _stakers List of staker address.
     * @return stakes List of staked amounts for each staker.
     */
    function getValidatorStakes(
        address validator,
        uint256 epoch,
        uint256 page,
        uint256 perPage
    ) external view returns (address[] memory _stakers, uint256[] memory stakes);

    /**
     * Returns a list of staking from Staker to a validator.
     * @param staker Staker address.
     * @param token Type of token.
     * @param epoch Target epoch number.
     * @return _validators List of validator address.
     * @return stakes List of staked amounts for each staker.
     * @return stakeRequests List of stake amounts to be added in the next epoch.
     * @return unstakeRequests List of stake amounts to be reduced in the next epoch.
     */
    function getStakerStakes(
        address staker,
        Token.Type token,
        uint256 epoch
    )
        external
        view
        returns (
            address[] memory _validators,
            uint256[] memory stakes,
            uint256[] memory stakeRequests,
            uint256[] memory unstakeRequests
        );

    /**
     * Returns the number of blocks the validator should create and the number of failed blocks.
     * @param validator Validator address.
     * @param epoch Target epoch number.
     * @return blocks Number of blocks to be created.
     * @return slashes Number of failed blocks.
     */
    function getBlockAndSlashes(address validator, uint256 epoch)
        external
        view
        returns (uint256 blocks, uint256 slashes);
}
