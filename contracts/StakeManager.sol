// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import { System } from "./System.sol";
import { Environment } from "./Environment.sol";
import { IAllowlist } from "./lib/IAllowlist.sol";
import { Constants } from "./lib/Constants.sol";
import { UpdateHistories } from "./lib/UpdateHistories.sol";
import { Validator as ValidatorLib } from "./lib/Validator.sol";
import { Staker as StakerLib } from "./lib/Staker.sol";
import { Token } from "./lib/Token.sol";

/**
 * @title StakeManager
 * @dev The StakeManager contract is the core contract of the proof-of-stake.
 *
 */
contract StakeManager is System {
    using UpdateHistories for uint256[];
    using ValidatorLib for Validator;
    using StakerLib for Staker;

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

    /*************
     * Constants *
     *************/

    Environment public environment;
    IAllowlist public allowlist;

    /*************
     * Variables *
     *************/

    // List of block creation validators
    address[] public currentValidators;
    // List of validators
    mapping(address => Validator) public validators;
    address[] public validatorOwners;
    // Mapping of validator operator to validator owner
    mapping(address => address) public operatorToOwner;
    // List of stakers
    mapping(address => Staker) public stakers;
    address[] public stakerSigners;
    // Log of update validators
    mapping(uint256 => address) public validatorUpdates;

    /*************
     * Modifiers *
     *************/

    /**
     * Modifier requiring the validator to be registered.
     * @param validator Validator address.
     */
    modifier validatorExists(address validator) {
        require(validators[validator].owner != address(0), "validator does not exist.");
        _;
    }

    /**
     * Modifier requiring the sender to be a registered staker.
     */
    modifier stakerExists() {
        require(stakers[msg.sender].signer != address(0), "staker does not exist.");
        _;
    }

    /**
     * Modifier requiring the sender to be a owner or operator of the validator.
     * @param validator Validator address.
     */
    modifier onlyValidatorOwnerOrOperator(address validator) {
        require(
            msg.sender == validators[validator].owner || msg.sender == validators[validator].operator,
            "you are not owner or operator."
        );
        _;
    }

    /**
     * Modifier requiring the current block to be the first block of the epoch.
     */
    modifier onlyFirstBlock() {
        // solhint-disable-next-line reason-string
        require(environment.isFirstBlock(), "only executable in the first block of epoch.");
        _;
    }

    /**
     * Modifier requiring the current block to be the last block of the epoch.
     */
    modifier onlyLastBlock() {
        // solhint-disable-next-line reason-string
        require(environment.isLastBlock(), "only executable in the last block of epoch.");
        _;
    }

    /**
     * Modifier requiring the current block not to be the last block of the epoch.
     */
    modifier onlyNotLastBlock() {
        // solhint-disable-next-line reason-string
        require(!environment.isLastBlock(), "not executable in the last block of epoch.");
        _;
    }

    /****************************
     * Functions for Validators *
     ****************************/

    /**
     * Initialization of contract.
     * This method is called by the genesis validator in the first epoch.
     * @param _environment Address of the Environment contract.
     */
    function initialize(Environment _environment, IAllowlist _allowlist) external onlyCoinbase initializer {
        environment = _environment;
        allowlist = _allowlist;
    }

    /**
     * Record validators that failed to create blocks.
     * @param operator Validator address.
     */
    function slash(address operator) external validatorExists(operatorToOwner[operator]) onlyCoinbase {
        // solhint-disable-next-line reason-string
        require(environment.epoch() > 1, "not executable in the first epoch.");

        Validator storage validator = validators[operatorToOwner[operator]];
        validator.slash(environment);
        emit ValidatorSlashed(validator.owner);
    }

    /**
     * Stores the number of blocks per validator should create at the current epoch.
     * The value is calculated by the validator that creates the first block of the epoch.
     * @param operators List of validator address.
     * @param counts List of blocks per validator.
     */
    function updateValidatorBlocks(address[] memory operators, uint256[] memory counts)
        external
        onlyFirstBlock
        onlyCoinbase
    {
        uint256 epoch = environment.epoch();
        uint256 total;
        for (uint256 i = 0; i < operators.length; i++) {
            validators[operatorToOwner[operators[i]]].blocks[epoch] = counts[i];
            total += counts[i];
        }
        require(total == environment.value().epochPeriod, "block count is mismatch.");
    }

    /**
     * Select a validators for the next epoch based on current staking amounts and availability.
     * This method is called only once in the last block of the epoch.
     */
    function updateValidators() external onlyLastBlock onlyCoinbase {
        uint256 epoch = environment.epoch();
        require(validatorUpdates[epoch] == address(0), "already updated.");

        Environment.EnvironmentValue memory env = environment.value();

        // Jailed validators
        for (uint256 i = 0; i < currentValidators.length; i++) {
            Validator storage validator = validators[operatorToOwner[currentValidators[i]]];
            if (validator.jailEpoch == epoch || validator.slashes[epoch] < env.jailThreshold) continue;
            validator.jailEpoch = epoch;
            emit ValidatorJailed(validator.owner, epoch);
        }

        // Select validators for the next epoch
        address[] memory tmpValidators = new address[](validatorOwners.length);
        uint256 count = 0;
        for (uint256 i = 0; i < validatorOwners.length; i++) {
            Validator storage validator = validators[validatorOwners[i]];
            if (validator.isCandidates(environment)) {
                validator.epochs.push(epoch + 1);
                tmpValidators[count] = validator.operator;
                count++;
            }
        }

        currentValidators = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            currentValidators[i] = tmpValidators[i];
        }

        validatorUpdates[epoch] = msg.sender;
    }

    /*********************************************
     * Functions for Validator owner or operator *
     *********************************************/

    /**
     * Join as a validator in the proof-of-stake.
     * @param operator Address used for block signing.
     */
    function joinValidator(address operator) external {
        require(allowlist.containsAddress(msg.sender), "not allowed.");

        validators[msg.sender].join(operator);
        validatorOwners.push(msg.sender);
        operatorToOwner[operator] = msg.sender;
    }

    /**
     * Update the block signing address.
     * @param operator New address used for block signing.
     */
    function updateOperator(address operator) public validatorExists(msg.sender) {
        validators[msg.sender].updateOperator(operator);
        operatorToOwner[operator] = msg.sender;
    }

    /**
     * Change the validator status to active.
     * Changes will be applied from next epoch.
     * @param validator Validator address.
     */
    function activateValidator(address validator)
        external
        onlyValidatorOwnerOrOperator(validator)
        validatorExists(validator)
    {
        validators[validator].activate();
        emit ValidatorActivated(validator);
    }

    /**
     * Change the validator status to disable.
     * Changes will be applied from next epoch.
     * @param validator Validator address.
     */
    function deactivateValidator(address validator)
        external
        onlyValidatorOwnerOrOperator(validator)
        validatorExists(validator)
    {
        validators[validator].deactivate();
        emit ValidatorDeactivated(validator);
    }

    /**
     * Update validator commission rates.
     * Changes will be applied from next epoch.
     * @param newRate New commission rates(0%~100%).
     */
    function updateCommissionRate(uint256 newRate) external validatorExists(msg.sender) {
        validators[msg.sender].updateCommissionRate(environment, newRate);
        emit ValidatorCommissionRateUpdated(msg.sender, newRate);
    }

    /**
     * Withdraw validator commissions.
     * Both owner and operator can be executed, but the remittance destination will be owner address.
     * @param validator Validator address.
     * @param epochs Number of epochs to be withdrawn.
     *     If zero is specified, all commissions from the last withdrawal to the present will be withdrawn.
     *     If the gas limit is reached, specify a smaller value.
     */
    function claimCommissions(address validator, uint256 epochs)
        external
        onlyValidatorOwnerOrOperator(validator)
        validatorExists(validator)
    {
        validators[validator].claimCommissions(environment, epochs);
    }

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
    ) external payable validatorExists(validator) onlyNotLastBlock {
        require(amount > 0, "amount is zero.");

        Token.receives(token, msg.sender, amount);
        Staker storage staker = stakers[msg.sender];
        if (staker.signer == address(0)) {
            staker.signer = msg.sender;
            stakerSigners.push(msg.sender);
        }
        staker.stake(environment, validators[validator], token, amount);
        emit Staked(msg.sender, validator, token, amount);
    }

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
    ) external validatorExists(validator) stakerExists onlyNotLastBlock {
        require(amount > 0, "amount is zero.");

        amount = stakers[msg.sender].unstake(environment, validators[validator], token, amount);
        emit Unstaked(msg.sender, validator, token, amount);
    }

    /**
     * Withdraw staking rewards.
     * @param validator Validator address.
     * @param epochs Number of epochs to be withdrawn.
     *     If zero is specified, all rewards from the last withdrawal to the present will be withdrawn.
     *     If the gas limit is reached, specify a smaller value.
     */
    function claimRewards(address validator, uint256 epochs) external validatorExists(validator) stakerExists {
        stakers[msg.sender].claimRewards(environment, validators[validator], epochs);
    }

    /**
     * Withdraw unstaked tokens whose lock period has expired.
     */
    function claimUnstakes() external stakerExists {
        stakers[msg.sender].claimUnstakes(environment);
    }

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
        )
    {
        owners = new address[](currentValidators.length);
        operators = new address[](currentValidators.length);
        stakes = new uint256[](currentValidators.length);

        uint256 epoch = environment.epoch();
        if (environment.isLastBlock()) epoch++;

        for (uint256 i = 0; i < currentValidators.length; i++) {
            owners[i] = operatorToOwner[currentValidators[i]];
            operators[i] = currentValidators[i];
            stakes[i] = validators[owners[i]].getTotalStake(epoch);
        }
    }

    /**
     * Returns addresses of all validators.
     * @return List of validator address.
     */
    function getValidators() external view returns (address[] memory) {
        return validatorOwners;
    }

    /**
     * Returns staker addresses with pagination.
     * @param page Number of page.
     * @param perPage Number of addresses per page.
     * @return List of staker address.
     */
    function getStakers(uint256 page, uint256 perPage) external view returns (address[] memory) {
        page = page > 0 ? page : 1;
        perPage = perPage > 0 ? perPage : 50;

        uint256 length = stakerSigners.length;
        uint256 idx = perPage * page - perPage;

        address[] memory _stakers = new address[](perPage);
        uint256 i;
        for (; idx < perPage * page; idx++) {
            if (idx == length) break;
            _stakers[i] = stakerSigners[idx];
            i++;
        }
        return _stakers;
    }

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
        )
    {
        Validator storage _validator = validators[validator];
        return (
            _validator.operator,
            _validator.active,
            _validator.getTotalStake(environment.epoch()),
            _validator.getCommissionRate(environment.epoch()),
            _validator.jailEpoch
        );
    }

    /**
     * Returns staker information.
     * @param staker Staker address.
     * @param token Type of token.
     * @return stakes Total staked amounts.
     * @return unstakes Total unstaked amounts.
     */
    function getStakerInfo(address staker, Token.Type token) public view returns (uint256 stakes, uint256 unstakes) {
        Staker storage _staker = stakers[staker];
        return (
            _staker.getTotalStake(validatorOwners, token, environment.epoch()),
            _staker.getUnstakes(environment, token)
        );
    }

    /**
     * Returns the balance of validator commissions.
     * @param validator Validator address.
     * @param epochs Number of epochs to be calculated.
     *     If zero is specified, all balances from the last withdrawal to the present will be calculated.
     *     If the gas limit is reached, specify a smaller value.
     * @return commissions Commission balance.
     */
    function getCommissions(address validator, uint256 epochs) external view returns (uint256 commissions) {
        (commissions, ) = validators[validator].getCommissions(environment, epochs);
    }

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
    ) public view returns (uint256 rewards) {
        (rewards, ) = stakers[staker].getRewards(environment, validators[validator], epochs);
    }

    /**
     * Returns the total staking rewards for a given epoch period.
     * @param epochs Number of epochs to be calculated.
     * @return rewards Total staking rewards.
     */
    function getTotalRewards(uint256 epochs) external view returns (uint256 rewards) {
        uint256 epoch = environment.epoch() - epochs - 1;
        (uint256[] memory envUpdates, Environment.EnvironmentValue[] memory envValues) = environment.epochAndValues();
        for (uint256 i = 0; i < epochs; i++) {
            epoch += 1;
            Environment.EnvironmentValue memory env = envUpdates.find(envValues, epoch);
            for (uint256 j = 0; j < validatorOwners.length; j++) {
                rewards += validators[validatorOwners[j]].getRewards(env, epoch);
            }
        }
    }

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
    ) external view returns (address[] memory _stakers, uint256[] memory stakes) {
        epoch = epoch > 0 ? epoch : environment.epoch();
        page = page > 0 ? page : 1;
        perPage = perPage > 0 ? perPage : 50;

        Validator storage _validator = validators[validator];
        uint256 length = _validator.stakers.length;
        uint256 idx = perPage * page - perPage;

        _stakers = new address[](perPage);
        stakes = new uint256[](perPage);
        uint256 i;
        for (; idx < perPage * page; idx++) {
            if (idx == length) break;
            Staker storage staker = stakers[_validator.stakers[idx]];
            _stakers[i] = staker.signer;
            stakes[i] =
                staker.getStake(_validator.owner, Token.Type.OAS, epoch) +
                staker.getStake(_validator.owner, Token.Type.wOAS, epoch) +
                staker.getStake(_validator.owner, Token.Type.sOAS, epoch);
            i++;
        }
    }

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
        )
    {
        _validators = validatorOwners;
        (stakes, stakeRequests, unstakeRequests) = stakers[staker].getStakes(
            validatorOwners,
            token,
            epoch > 0 ? epoch : environment.epoch()
        );
    }

    /**
     * Returns the number of blocks the validator should create and the number of failed blocks.
     * @param validator Validator address.
     * @param epoch Target epoch number.
     * @return blocks Number of blocks to be created.
     * @return slashes Number of failed blocks.
     */
    function getBlockAndSlashes(address validator, uint256 epoch)
        public
        view
        returns (uint256 blocks, uint256 slashes)
    {
        (blocks, slashes) = validators[validator].getBlockAndSlashes(epoch > 0 ? epoch : environment.epoch());
    }
}
