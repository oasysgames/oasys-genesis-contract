// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import { System } from "./System.sol";
import { IStakeManager } from "./IStakeManager.sol";
import { IEnvironment } from "./IEnvironment.sol";
import { IAllowlist } from "./lib/IAllowlist.sol";
import { UpdateHistories } from "./lib/UpdateHistories.sol";
import { Validator as ValidatorLib } from "./lib/Validator.sol";
import { Staker as StakerLib } from "./lib/Staker.sol";
import { Token } from "./lib/Token.sol";

/**
 * @title StakeManager
 * @dev The StakeManager contract is the core contract of the proof-of-stake.
 *
 */
contract StakeManager is IStakeManager, System {
    using UpdateHistories for uint256[];
    using ValidatorLib for Validator;
    using StakerLib for Staker;

    /*************
     * Constants *
     *************/

    IEnvironment public environment;
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
     * @inheritdoc IStakeManager
     */
    function initialize(IEnvironment _environment, IAllowlist _allowlist) external onlyCoinbase initializer {
        environment = _environment;
        allowlist = _allowlist;
    }

    /**
     * @inheritdoc IStakeManager
     */
    function slash(address operator) external validatorExists(operatorToOwner[operator]) onlyCoinbase {
        // solhint-disable-next-line reason-string
        require(environment.epoch() > 1, "not executable in the first epoch.");

        Validator storage validator = validators[operatorToOwner[operator]];
        validator.slash(environment);
        emit ValidatorSlashed(validator.owner);
    }

    /**
     * @inheritdoc IStakeManager
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
     * @inheritdoc IStakeManager
     */
    function updateValidators() external onlyLastBlock onlyCoinbase {
        uint256 epoch = environment.epoch();
        require(validatorUpdates[epoch] == address(0), "already updated.");

        IEnvironment.EnvironmentValue memory env = environment.value();

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
     * @inheritdoc IStakeManager
     */
    function joinValidator(address operator) external {
        require(allowlist.containsAddress(msg.sender), "not allowed.");

        validators[msg.sender].join(operator);
        validatorOwners.push(msg.sender);
        operatorToOwner[operator] = msg.sender;
    }

    /**
     * @inheritdoc IStakeManager
     */
    function updateOperator(address operator) external validatorExists(msg.sender) {
        validators[msg.sender].updateOperator(operator);
        operatorToOwner[operator] = msg.sender;
    }

    /**
     * @inheritdoc IStakeManager
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
     * @inheritdoc IStakeManager
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
     * @inheritdoc IStakeManager
     */
    function updateCommissionRate(uint256 newRate) external validatorExists(msg.sender) {
        validators[msg.sender].updateCommissionRate(environment, newRate);
        emit ValidatorCommissionRateUpdated(msg.sender, newRate);
    }

    /**
     * @inheritdoc IStakeManager
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
     * @inheritdoc IStakeManager
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
     * @inheritdoc IStakeManager
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
     * @inheritdoc IStakeManager
     */
    function claimRewards(address validator, uint256 epochs) external validatorExists(validator) stakerExists {
        stakers[msg.sender].claimRewards(environment, validators[validator], epochs);
    }

    /**
     * @inheritdoc IStakeManager
     */
    function claimUnstakes() external stakerExists {
        stakers[msg.sender].claimUnstakes(environment);
    }

    /******************
     * View Functions *
     ******************/

    /**
     * @inheritdoc IStakeManager
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
     * @inheritdoc IStakeManager
     */
    function getValidators() external view returns (address[] memory) {
        return validatorOwners;
    }

    /**
     * @inheritdoc IStakeManager
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
     * @inheritdoc IStakeManager
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
     * @inheritdoc IStakeManager
     */
    function getStakerInfo(address staker, Token.Type token) external view returns (uint256 stakes, uint256 unstakes) {
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
     * @inheritdoc IStakeManager
     */
    function getCommissions(address validator, uint256 epochs) external view returns (uint256 commissions) {
        (commissions, ) = validators[validator].getCommissions(environment, epochs);
    }

    /**
     * @inheritdoc IStakeManager
     */
    function getRewards(
        address staker,
        address validator,
        uint256 epochs
    ) external view returns (uint256 rewards) {
        (rewards, ) = stakers[staker].getRewards(environment, validators[validator], epochs);
    }

    /**
     * Returns the total staking rewards for a given epoch period.
     * @param epochs Number of epochs to be calculated.
     * @return rewards Total staking rewards.
     * @inheritdoc IStakeManager
     */
    function getTotalRewards(uint256 epochs) external view returns (uint256 rewards) {
        uint256 epoch = environment.epoch() - epochs - 1;
        (uint256[] memory envUpdates, IEnvironment.EnvironmentValue[] memory envValues) = environment.epochAndValues();
        for (uint256 i = 0; i < epochs; i++) {
            epoch += 1;
            IEnvironment.EnvironmentValue memory env = envUpdates.find(envValues, epoch);
            for (uint256 j = 0; j < validatorOwners.length; j++) {
                rewards += validators[validatorOwners[j]].getRewards(env, epoch);
            }
        }
    }

    /**
     * @inheritdoc IStakeManager
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
     * @inheritdoc IStakeManager
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
     * @inheritdoc IStakeManager
     */
    function getBlockAndSlashes(address validator, uint256 epoch)
        external
        view
        returns (uint256 blocks, uint256 slashes)
    {
        (blocks, slashes) = validators[validator].getBlockAndSlashes(epoch > 0 ? epoch : environment.epoch());
    }
}
