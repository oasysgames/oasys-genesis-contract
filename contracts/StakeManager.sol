// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import { System } from "./System.sol";
import { Constants, UpdateHistoriesLib } from "./lib/Common.sol";
import { IEnvironment } from "./IEnvironment.sol";
import { IStakeManager, ValidatorLib, StakerLib } from "./IStakeManager.sol";

contract StakeManager is System, IStakeManager {
    using UpdateHistoriesLib for uint256[];
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
    event Staked(address indexed staker, address indexed validator, uint256 amount);
    event Unstaked(address indexed staker, address indexed validator, uint256 amount);

    /*************
     * Constants *
     *************/

    IEnvironment public environment;

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

    modifier validatorExists(address validator) {
        require(validators[validator].owner != address(0), "validator does not exist.");
        _;
    }

    modifier stakerExists() {
        require(stakers[msg.sender].signer != address(0), "staker does not exist.");
        _;
    }

    modifier onlyValidatorOwnerOrOperator(address validator) {
        require(
            msg.sender == validators[validator].owner || msg.sender == validators[validator].operator,
            "you are not owner or operator."
        );
        _;
    }

    modifier onlyFirstBlock() {
        // solhint-disable-next-line reason-string
        require(environment.isFirstBlock(), "only executable in the first block of epoch.");
        _;
    }

    modifier onlyLastBlock() {
        // solhint-disable-next-line reason-string
        require(environment.isLastBlock(), "only executable in the last block of epoch.");
        _;
    }

    modifier onlyNotLastBlock() {
        // solhint-disable-next-line reason-string
        require(!environment.isLastBlock(), "not executable in the last block of epoch.");
        _;
    }

    /****************************
     * Functions for Validators *
     ****************************/

    function initialize(IEnvironment _environment) external onlyCoinbase initializer {
        environment = _environment;
    }

    function slash(address operator) external validatorExists(operatorToOwner[operator]) onlyCoinbase {
        // solhint-disable-next-line reason-string
        require(environment.epoch() > 1, "not executable in the first epoch.");

        Validator storage validator = validators[operatorToOwner[operator]];
        validator.slash(environment);
        emit ValidatorSlashed(validator.owner);
    }

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

    function updateValidators() external onlyLastBlock onlyCoinbase {
        uint256 epoch = environment.epoch();
        require(validatorUpdates[epoch] == address(0), "already updated.");

        IEnvironment.Environment memory env = environment.value();

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

    function joinValidator(address operator) external {
        validators[msg.sender].join(operator);
        validatorOwners.push(msg.sender);
        operatorToOwner[operator] = msg.sender;
    }

    function updateOperator(address operator) public validatorExists(msg.sender) {
        validators[msg.sender].updateOperator(operator);
        operatorToOwner[operator] = msg.sender;
    }

    function activateValidator(address validator)
        external
        onlyValidatorOwnerOrOperator(validator)
        validatorExists(validator)
    {
        validators[validator].activate();
        emit ValidatorActivated(validator);
    }

    function deactivateValidator(address validator)
        external
        onlyValidatorOwnerOrOperator(validator)
        validatorExists(validator)
    {
        validators[validator].deactivate();
        emit ValidatorDeactivated(validator);
    }

    function updateCommissionRate(uint256 newRate) external validatorExists(msg.sender) {
        validators[msg.sender].updateCommissionRate(environment, newRate);
        emit ValidatorCommissionRateUpdated(msg.sender, newRate);
    }

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

    function stake(address validator) external payable validatorExists(validator) onlyNotLastBlock {
        require(msg.value > 0, "amount is zero.");

        Staker storage staker = stakers[msg.sender];
        if (staker.signer == address(0)) {
            staker.signer = msg.sender;
            stakerSigners.push(msg.sender);
        }
        staker.stake(environment, validators[validator], msg.value);
        emit Staked(msg.sender, validator, msg.value);
    }

    function unstake(address validator, uint256 amount)
        external
        validatorExists(validator)
        stakerExists
        onlyNotLastBlock
    {
        require(amount > 0, "amount is zero.");

        amount = stakers[msg.sender].unstake(environment, validators[validator], amount);
        emit Unstaked(msg.sender, validator, amount);
    }

    function claimRewards(address validator, uint256 epochs) external validatorExists(validator) stakerExists {
        stakers[msg.sender].claimRewards(environment, validators[validator], epochs);
    }

    function claimUnstakes() external stakerExists {
        stakers[msg.sender].claimUnstakes(environment);
    }

    /******************
     * View Functions *
     ******************/

    function getCurrentValidators()
        external
        view
        override
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

    function getValidators() external view returns (address[] memory) {
        return validatorOwners;
    }

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

    function getStakerInfo(address staker) public view returns (uint256 stakes, uint256 unstakes) {
        Staker storage _staker = stakers[staker];
        return (_staker.getTotalStake(validatorOwners, environment.epoch()), _staker.getUnstakes(environment));
    }

    function getCommissions(address validator, uint256 epochs) external view returns (uint256 commissions) {
        (commissions, ) = validators[validator].getCommissions(environment, epochs);
    }

    function getRewards(
        address staker,
        address validator,
        uint256 epochs
    ) public view returns (uint256 rewards) {
        (rewards, ) = stakers[staker].getRewards(environment, validators[validator], epochs);
    }

    function getTotalRewards(uint256 epochs) external view returns (uint256 rewards) {
        uint256 epoch = environment.epoch() - epochs - 1;
        (uint256[] memory envUpdates, IEnvironment.Environment[] memory envValues) = environment.epochAndValues();
        for (uint256 i = 0; i < epochs; i++) {
            epoch += 1;
            IEnvironment.Environment memory env = envUpdates.find(envValues, epoch);
            for (uint256 j = 0; j < validatorOwners.length; j++) {
                rewards += validators[validatorOwners[j]].getRewards(env, epoch);
            }
        }
    }

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
            stakes[i] = staker.getStake(_validator.owner, epoch);
            i++;
        }
    }

    function getStakerStakes(address staker, uint256 epoch)
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
            epoch > 0 ? epoch : environment.epoch()
        );
    }

    function getBlockAndSlashes(address validator, uint256 epoch)
        public
        view
        returns (uint256 blocks, uint256 slashes)
    {
        (blocks, slashes) = validators[validator].getBlockAndSlashes(epoch > 0 ? epoch : environment.epoch());
    }
}
