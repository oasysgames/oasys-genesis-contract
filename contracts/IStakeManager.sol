// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

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

    event AddedRewardBalance(uint256 amount);
    event ValidatorJoined(address validator);
    event ValidatorActivated(address indexed validator, uint256[] epochs);
    event ValidatorDeactivated(address indexed validator, uint256[] epochs);
    event ValidatorSlashed(address indexed validator);
    event ValidatorJailed(address indexed validator, uint256 until);
    event OperatorUpdated(address indexed validator, address oldOperator, address newOperator);
    event BLSPublicKeyUpdated(address indexed validator, bytes oldBLSPublicKey, bytes newBLSPublicKey);
    event Staked(address indexed staker, address indexed validator, Token.Type token, uint256 amount);
    event ReStaked(address indexed staker, address indexed validator, uint256 amount);
    event Unstaked(address indexed staker, address indexed validator, Token.Type token, uint256 amount);
    event UnstakedV2(address indexed staker, address indexed validator, uint256 lockedUnstake);
    event ClaimedCommissions(address indexed validator, uint256 amount);
    event ClaimedRewards(address indexed staker, address validator, uint256 amount);
    event ClaimedLockedUnstake(address indexed staker, uint256 lockedUnstake);

    /***********
     * Structs *
     ***********/

    struct Validator {
        // Validator address
        address owner;
        // Address used for block signing
        address operator;
        // List of inactive epoch numbers.
        mapping(uint256 => bool) inactives;
        // List of jailed epoch numbers.
        mapping(uint256 => bool) jails;
        // Stake updated epochs
        uint256[] stakeUpdates;
        // Stake amounts per epoch
        uint256[] stakeAmounts;
        // Epoch of last claimed of commissions
        uint256 lastClaimCommission;
        // List of stakers
        address[] stakers;
        mapping(address => bool) stakerExists;
        // Expected number of block createds per epoch
        mapping(uint256 => uint256) blocks;
        // Number of slashes per epoch
        mapping(uint256 => uint256) slashes;
        // ----- added from v1.6.0 -----
        // BLS public key used for fast finality
        bytes blsPublicKey;
    }

    struct Staker {
        // Staker address
        address signer;
        // Stake updated epochs
        mapping(Token.Type => mapping(address => uint256[])) stakeUpdates;
        // Stake amounts per epoch
        mapping(Token.Type => mapping(address => uint256[])) stakeAmounts;
        // Last epoch to withdrawl unstake
        mapping(Token.Type => uint256[]) unstakeUpdates;
        // Unstake amounts per epoch
        mapping(Token.Type => uint256[]) unstakeAmounts;
        // Epoch of last claimed of rewards per validator
        mapping(address => uint256) lastClaimReward;
        // List of locked unstakes
        LockedUnstake[] lockedUnstakes;
    }

    struct LockedUnstake {
        Token.Type token;
        uint256 amount;
        uint256 unlockTime;
    }

    /**
     * Add reward balance.
     */
    function addRewardBalance() external payable;

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
     * @param blocks Expected number of block createds.
     */
    function slash(address operator, uint256 blocks) external;

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
     * Update the BLS public key.
     * @param blsPublicKey New BLS public key.
     */
    function updateBLSPublicKey(bytes calldata blsPublicKey) external;

    /**
     * Change the validator status to active.
     * Changes will be applied from next epoch.
     * @param validator Validator address.
     * @param epochs List of epoch numbers to active.
     */
    function activateValidator(address validator, uint256[] memory epochs) external;

    /**
     * Change validator status to disabled.
     * Changes will be applied from next epoch.
     * @param validator Validator address.
     * @param epochs List of epoch numbers to inactive.
     */
    function deactivateValidator(address validator, uint256[] memory epochs) external;

    /**
     * Withdraw validator commissions.
     * @param validator [UNUSED] Validator address.
     * @param epochs Number of epochs to be withdrawn.
     *     If zero is specified, all commissions from the last withdrawal to the present will be withdrawn.
     *     If the gas limit is reached, specify a smaller value.
     */
    function claimCommissions(address validator, uint256 epochs) external;

    /**
     * Stake commissions to yourself.
     * The stakes will be effective from current epoch and rewards will be granted.
     * @param epochs Number of epochs to be stake.
     *     If zero is specified, all commissions from the last withdrawal to the present are staked.
     *     If the gas limit is reached, specify a smaller value.
     */
    function restakeCommissions(uint256 epochs) external;

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
     * [OBSOLETED] Unstake tokens from validator.
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
     * Unstake tokens from validator. The unstaked token will be locked about 10 days.
     * Rewards for the current epoch will be granted.
     * @param validator Validator address.
     * @param token Type of token.
     * @param amount Unstake amounts.
     */
    function unstakeV2(
        address validator,
        Token.Type token,
        uint256 amount
    ) external;

    /**
     * Withdraw unstaked tokens whose lock period has expired.
     * @param staker [UNUSED] Staker address.
     */
    function claimUnstakes(address staker) external;

    /**
     * Withdraw unstaked token whose lock period has expired.
     * @param lockedUnstake The index of unstake request.
     */
    function claimLockedUnstake(uint256 lockedUnstake) external;

    /**
     * Withdraw staking rewards.
     * @param staker Staker address.
     * @param validator Validator address.
     * @param epochs Number of epochs to be withdrawn.
     *     If zero is specified, all rewards from the last withdrawal to the present will be withdrawn.
     *     If the gas limit is reached, specify a smaller value.
     */
    function claimRewards(
        address staker,
        address validator,
        uint256 epochs
    ) external;

    /**
     * Stake rewards to validator.
     * The stakes will be effective from current epoch and rewards will be granted.
     * @param validator Validator address.
     * @param epochs Number of epochs to be stake.
     *     If zero is specified, all rewards from the last withdrawal to the present are staked.
     *     If the gas limit is reached, specify a smaller value.
     */
    function restakeRewards(address validator, uint256 epochs) external;

    /******************
     * View Functions *
     ******************/

    /**
     * Returns validators.
     * @param epoch Target epoch number.
     * @param cursor The index of the first item being requested.
     * @param howMany Indicates how many items should be returned.
     * @return owners List of validator owner addresses.
     * @return operators List of addresses for block signing.
     * @return stakes List of total staked amounts for each validator.
     * @return blsPublicKeys List of BLS public keys.
     * @return candidates List of whether new blocks can be produced.
     * @return newCursor Cursor that should be used in the next request.
     */
    function getValidators(
        uint256 epoch,
        uint256 cursor,
        uint256 howMany
    )
        external
        view
        returns (
            address[] memory owners,
            address[] memory operators,
            uint256[] memory stakes,
            bytes[] memory blsPublicKeys,
            bool[] memory candidates,
            uint256 newCursor
        );

    /**
     * Returns validator owner addresses with pagination.
     * @param cursor The index of the first item being requested.
     * @param howMany Indicates how many items should be returned.
     * @return owners List of validator owner addresses.
     * @return newCursor Cursor that should be used in the next request.
     */
    function getValidatorOwners(uint256 cursor, uint256 howMany)
        external
        view
        returns (address[] memory owners, uint256 newCursor);

    /**
     * Returns staker addresses with pagination.
     * @param cursor The index of the first item being requested.
     * @param howMany Indicates how many items should be returned.
     * @return stakers List of staker addresses.
     * @return newCursor Cursor that should be used in the next request.
     */
    function getStakers(uint256 cursor, uint256 howMany)
        external
        view
        returns (address[] memory stakers, uint256 newCursor);

    /**
     * Returns the validator information for the specified epoch.
     * @param validator Validator address.
     * @param epoch Target epoch number.
     * @return operator Address used for block signing
     * @return active Validator status.
     * @return jailed Jailing status.
     * @return candidate Whether new blocks can be produced.
     * @return stakes Total staked amounts.
     */
    function getValidatorInfo(address validator, uint256 epoch)
        external
        view
        returns (
            address operator,
            bool active,
            bool jailed,
            bool candidate,
            uint256 stakes,
            bytes memory blsPublicKey
        );

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
     * Returns total unstaked amounts.
     * @param staker Staker address.
     * @return oasUnstakes Amount of unstaked OAS.
     * @return woasUnstakes Amount of unstaked wOAS.
     * @return soasUnstakes Amount of unstaked sOAS.
     */
    function getUnstakes(address staker)
        external
        view
        returns (
            uint256 oasUnstakes,
            uint256 woasUnstakes,
            uint256 soasUnstakes
        );

    /**
     * Returns number of locked unstakes.
     * @param staker Staker address.
     * @return count Number of locked unstakes.
     */
    function getLockedUnstakeCount(address staker) external returns (uint256 count);

    /**
     * Returns specific locked unstake.
     * @param staker Staker address.
     * @param lockedUnstake The index of unstake request.
     * @return token Type of locked token.
     * @return amount Amount of locked token.
     * @return unlockTime Block time to be unlocked.
     * @return claimable Whether locked token can be claimed.
     */
    function getLockedUnstake(address staker, uint256 lockedUnstake)
        external
        view
        returns (
            Token.Type token,
            uint256 amount,
            uint256 unlockTime,
            bool claimable
        );

    /**
     * Returns list of locked unstakes.
     * @param staker Staker address.
     * @param cursor The index of the first item being requested.
     * @param howMany Indicates how many items should be returned.
     * @return tokens Type of locked token.
     * @return amounts Amount of locked token.
     * @return unlockTimes Block time to be unlocked.
     * @return claimable Whether locked token can be claimed.
     * @return newCursor Cursor that should be used in the next request.
     */
    function getLockedUnstakes(
        address staker,
        uint256 cursor,
        uint256 howMany
    )
        external
        view
        returns (
            Token.Type[] memory tokens,
            uint256[] memory amounts,
            uint256[] memory unlockTimes,
            bool[] memory claimable,
            uint256 newCursor
        );

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
     * Returns total staked amounts.
     * @param epoch Target epoch number.
     * @return amounts Total staked amounts.
     */
    function getTotalStake(uint256 epoch) external view returns (uint256 amounts);

    /**
     * Returns the total staking reward from addresses and epoch period.
     * @param validators List of validator owner addresses.
     * @param epochs Number of epochs to be calculated.
     * @return rewards Total staking rewards.
     */
    function getTotalRewards(address[] memory validators, uint256 epochs) external view returns (uint256 rewards);

    /**
     * Returns the staked amount of the validator.
     * @param validator Validator address.
     * @param epoch Target epoch number.
     * @return stakes Staked amounts.
     */
    function getValidatorStakes(address validator, uint256 epoch) external view returns (uint256 stakes);

    /**
     * Returns the staked amount of the operator.
     * @param operator Operator address.
     * @param epoch Target epoch number.
     * @return stakes Staked amounts.
     */
    function getOperatorStakes(address operator, uint256 epoch) external view returns (uint256 stakes);

    /**
     * Returns a list of stakers and amounts to the validator.
     * @param validator Validator address.
     * @param epoch Target epoch number.
     * @param cursor The index of the first item being requested.
     * @param howMany Indicates how many items should be returned.
     * @return stakers List of staker address.
     * @return stakes List of staked amounts for each staker.
     * @return newCursor Cursor that should be used in the next request.
     */
    function getValidatorStakes(
        address validator,
        uint256 epoch,
        uint256 cursor,
        uint256 howMany
    )
        external
        view
        returns (
            address[] memory stakers,
            uint256[] memory stakes,
            uint256 newCursor
        );

    /**
     * Returns a list of staking from Staker to a validator.
     * @param staker Staker address.
     * @param epoch Target epoch number.
     * @param cursor The index of the first item being requested.
     * @param howMany Indicates how many items should be returned.
     * @return validators List of validator address.
     * @return oasStakes List of OAS amounts for each validator.
     * @return woasStakes List of wOAS amounts for each validator.
     * @return soasStakes List of sOAS amounts for each validator.
     * @return newCursor Cursor that should be used in the next request.
     */
    function getStakerStakes(
        address staker,
        uint256 epoch,
        uint256 cursor,
        uint256 howMany
    )
        external
        view
        returns (
            address[] memory validators,
            uint256[] memory oasStakes,
            uint256[] memory woasStakes,
            uint256[] memory soasStakes,
            uint256 newCursor
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
