// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

error InvalidDestination();

// SOAS is already minted.
error AlreadyMinted();

// Invalid since or until.
error InvalidClaimPeriod();

// OAS is zero.
error NoAmount();

// Over claimable OAS.
error OverAmount();

// OAS transfer failed.
error TransferFailed();

// Cannot renounce.
error CannotRenounce();

// Only staking contracts or burn are allowed.
error UnauthorizedTransfer();

/**
 * @title SOAS
 * @dev The SOAS is non-transferable but stakable token.
 * It is possible to gradually convert from since to until period to OAS.
 */
contract SOAS is ERC20 {
    /**********
     * Struct *
     **********/

    struct ClaimInfo {
        uint256 amount;
        uint256 claimed;
        uint64 since;
        uint64 until;
        address from;
    }

    /**********************
     * Contract Variables *
     **********************/

    address public staking;
    mapping(address => ClaimInfo) private claimInfo;

    /**********
     * Events *
     **********/

    event Mint(address indexed to, uint256 amount, uint256 since, uint256 until);
    event Claim(address indexed holder, uint256 amount);
    event Renounce(address indexed holder, uint256 amount);

    /***************
     * Constructor *
     ***************/

    /**
     * @param _staking Address of the Staking contract.
     */
    constructor(address _staking) ERC20("Stakable OAS", "SOAS") {
        staking = _staking;
    }

    /********************
     * Public Functions *
     ********************/

    /**
     * Mint the SOAS by depositing the OAS.
     * @param to Destination address for the SOAS.
     * @param since Unixtime to start converting the SOAS to the OAS.
     * @param until Unixtime when all the SOAS can be converted to the OAS
     */
    function mint(
        address to,
        uint64 since,
        uint64 until
    ) external payable {
        if (to == address(0) || to == staking) revert InvalidDestination();
        if (claimInfo[to].amount != 0) revert AlreadyMinted();
        if (since <= block.timestamp || since >= until) revert InvalidClaimPeriod();
        if (msg.value == 0) revert NoAmount();

        _mint(to, msg.value);
        claimInfo[to] = ClaimInfo(msg.value, 0, since, until, msg.sender);

        emit Mint(to, msg.value, since, until);
    }

    /**
     * Convert the SOAS to the OAS.
     * @param amount Amount of the SOAS.
     */
    function claim(uint256 amount) external {
        require(amount > 0, "amount is zero");

        uint256 currentClaimableOAS = getClaimableOAS(msg.sender) - claimInfo[msg.sender].claimed;
        if (amount > currentClaimableOAS) revert OverAmount();

        claimInfo[msg.sender].claimed += amount;
        _burn(msg.sender, amount);
        (bool success, ) = msg.sender.call{ value: amount }("");
        if (!success) revert TransferFailed();

        emit Claim(msg.sender, amount);
    }

    /**
     * Return the SOAS as the OAS to the address that minted it.
     * @param amount Amount of the SOAS.
     */
    function renounce(uint256 amount) external {
        require(amount > 0, "amount is zero");

        ClaimInfo memory info = claimInfo[msg.sender];
        if (amount > info.amount - info.claimed) revert OverAmount();

        _burn(msg.sender, amount);
        (bool success, ) = info.from.call{ value: amount }("");
        if (!success) revert TransferFailed();

        emit Renounce(msg.sender, amount);
    }

    /**
     * Get the Claim Info.
     * @param holder Holder of the SOAS token.
     */
    function getClaimInfo(address holder) external view returns (ClaimInfo memory) {
        return claimInfo[holder];
    }

    /**
     * Get current amount of the SOAS available for conversion.
     * @param holder Holder of the SOAS token.
     */
    function getClaimableOAS(address holder) public view returns (uint256) {
        ClaimInfo memory info = claimInfo[holder];
        if (info.amount == 0) {
            return 0;
        }
        if (block.timestamp < info.since) {
            return 0;
        }
        uint256 amount = (info.amount * (block.timestamp - info.since)) / (info.until - info.since);
        if (amount > info.amount) {
            return info.amount;
        }
        return amount;
    }

    /**********************
     * Internal Functions *
     **********************/

    /**
     * The SOAS is allowed to mint, burn and transfer with the Staking contract.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal view override {
        if (!(from == address(0) || to == address(0) || from == staking || to == staking)) {
            revert UnauthorizedTransfer();
        }
    }
}
