// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

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
        uint256 since;
        uint256 until;
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
        uint256 since,
        uint256 until
    ) external payable {
        require(to != staking, "cannot mint to staking contract");
        require(claimInfo[to].amount == 0, "already mint");
        require(block.timestamp < since && since < until, "invalid since or until");
        require(msg.value > 0, "no OAS");

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
        require(currentClaimableOAS >= amount, "over claimable OAS");

        _burn(msg.sender, amount);
        (bool success, ) = msg.sender.call{ value: amount }(new bytes(0));
        require(success, "OAS transfer failed");

        claimInfo[msg.sender].claimed += amount;

        emit Claim(msg.sender, amount);
    }

    /**
     * Return the SOAS as the OAS to the address that minted it.
     * @param amount Amount of the SOAS.
     */
    function renounce(uint256 amount) external {
        require(amount > 0, "amount is zero");

        ClaimInfo memory info = claimInfo[msg.sender];
        require(info.amount - info.claimed >= amount, "cannot renounce");

        _burn(msg.sender, amount);
        (bool success, ) = info.from.call{ value: amount }(new bytes(0));
        require(success, "OAS transfer failed");

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
        require(from == address(0) || to == address(0) || from == staking || to == staking, "cannot trasfer");
    }
}
