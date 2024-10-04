// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Invalid mint destinaition.
error InvalidDestination();

// Already claimer address.
error AlreadyClaimer();

// Invalid since or until.
error InvalidClaimPeriod();

// OAS is zero.
error NoAmount();

// Invalid minter address.
error InvalidMinter();

// Invalid revoker address.
error InvalidRevoker();

// Over claimable OAS.
error OverAmount();

// OAS transfer failed.
error TransferFailed();

// Cannot renounce.
error CannotRenounce();

// Only staking contracts or burn are allowed.
error UnauthorizedTransfer();

/**
 * @title LOAS
 * @dev The LOAS is non-transferable token.
 * It is possible to gradually convert from since to until period to OAS.
 */
contract LOAS is ERC20 {
    /**********
     * Struct *
     **********/

    struct ClaimInfo {
        uint256 amount;
        uint256 claimed;
        uint64 since;
        uint64 until;
        address from;
        uint256 revoked;
    }

    /**********************
     * Contract Variables *
     **********************/

    mapping(address => ClaimInfo) public claimInfo;
    mapping(address => address) public originalClaimer;

    /**********
     * Events *
     **********/

    event Mint(address indexed to, uint256 amount, uint256 since, uint256 until);
    event Claim(address indexed holder, uint256 amount);
    event Renounce(address indexed holder, uint256 amount);
    event Revoke(address indexed original, address indexed holder, uint256 amount);
    event Allow(address indexed original, address indexed transferable);

    /***************
     * Constructor *
     ***************/

    constructor() ERC20("Locked OAS", "LOAS") {}

    /********************
     * Public Functions *
     ********************/

    /**
     * Mint the LOAS by depositing the OAS.
     * @param to Destination address for the LOAS.
     * @param since Unixtime to start converting the LOAS to the OAS.
     * @param until Unixtime when all the LOAS can be converted to the OAS
     */
    function mint(
        address to,
        uint64 since,
        uint64 until
    ) external payable {
        if (to == address(0)) revert InvalidDestination();
        if (originalClaimer[to] != address(0)) revert AlreadyClaimer();
        if (since <= block.timestamp || since >= until) revert InvalidClaimPeriod();
        if (msg.value == 0) revert NoAmount();

        _mint(to, msg.value);
        claimInfo[to] = ClaimInfo(msg.value, 0, since, until, msg.sender, 0);
        originalClaimer[to] = to;

        emit Mint(to, msg.value, since, until);
    }

    /**
     * Allow the transferable address for the claimer address.
     * @param original Address of the claimer.
     * @param allowed Transferable address.
     */
    function allow(address original, address allowed) external {
        if (claimInfo[original].from != msg.sender) revert InvalidMinter();

        _allow(original, allowed);
    }

    /**
     * Bulk allow
     * @param original Address of the claimer.
     * @param alloweds List of allowed address.
     */
    function allow(address original, address[] memory alloweds) external {
        if (claimInfo[original].from != msg.sender) revert InvalidMinter();

        for (uint256 i; i < alloweds.length; i++) {
            _allow(original, alloweds[i]);
        }
    }

    /**
     * Convert the LOAS to the OAS.
     * @param amount Amount of the LOAS.
     */
    function claim(uint256 amount) external {
        if (amount == 0) revert NoAmount();

        ClaimInfo storage originalClaimInfo = claimInfo[originalClaimer[msg.sender]];
        uint256 currentClaimableOAS = getClaimableOAS(originalClaimer[msg.sender]) - originalClaimInfo.claimed;
        if (amount > currentClaimableOAS) revert OverAmount();

        originalClaimInfo.claimed += amount;

        _burn(msg.sender, amount);
        (bool success, ) = msg.sender.call{ value: amount }("");
        if (!success) revert TransferFailed();

        emit Claim(originalClaimer[msg.sender], amount);
    }

    /**
     * Return the LOAS as the OAS to the address that minted it.
     * @param amount Amount of the LOAS.
     */
    function renounce(uint256 amount) external {
        if (amount == 0) revert NoAmount();

        ClaimInfo storage originalClaimInfo = claimInfo[originalClaimer[msg.sender]];
        uint256 remainingAmount = originalClaimInfo.amount - originalClaimInfo.claimed - originalClaimInfo.revoked;
        if (amount > remainingAmount) revert OverAmount();

        _burn(msg.sender, amount);
        (bool success, ) = originalClaimInfo.from.call{ value: amount }("");
        if (!success) revert TransferFailed();

        emit Renounce(originalClaimer[msg.sender], amount);
    }

    /**
     * Revoke the LOAS from the holder.
     * As the default behavior, only the locked amount can be revoked.
     * otherwise, the amount can be specified.
     * @param original Address of the original claimer.
     * @param holder Address of the holder.
     * @param amount_ Amount of the LOAS.
     */
    function revoke(address original, address holder, uint256 amount_) external {
        // Only the minter can revoke the LOAS.
        ClaimInfo storage originalClaimInfo = claimInfo[original];
        if (originalClaimInfo.from != msg.sender) revert InvalidRevoker();

        // Determine the amount to revoke.
        uint256 amount = amount_;
        if (amount == 0) {
            // As a default, revoke only the locked amount.
            uint256 remainingAmount = originalClaimInfo.amount - originalClaimInfo.claimed - originalClaimInfo.revoked;
            uint256 currentClaimableOAS = getClaimableOAS(original) - originalClaimInfo.claimed;
            if (remainingAmount <= currentClaimableOAS) revert NoAmount(); // Sanity check
            amount = remainingAmount - currentClaimableOAS;
        }

        // Check over amount.
        if (balanceOf(holder) < amount) revert OverAmount();

        // Revoke the LOAS.
        originalClaimInfo.revoked += amount;
        _burn(holder, amount);
        (bool success, ) = msg.sender.call{ value: amount }("");
        if (!success) revert TransferFailed();

        emit Revoke(original, holder, amount);
    }

    /**
     * Bulk transfer
     * @param tos List of receipient address.
     * @param amounts List of amount.
     */
    function transfer(address[] memory tos, uint256[] memory amounts) public returns (bool) {
        require(tos.length == amounts.length, "LOAS: bulk transfer args must be equals");
        address owner = _msgSender();
        for (uint256 i; i < tos.length; i++) {
            _transfer(owner, tos[i], amounts[i]);
        }
        return true;
    }

    /**
     * Bulk transferFrom
     * @param froms List of sender address.
     * @param tos List of receipient address.
     * @param amounts List of amount.
     */
    function transferFrom(
        address[] memory froms,
        address[] memory tos,
        uint256[] memory amounts
    ) public returns (bool) {
        require(
            froms.length == tos.length && tos.length == amounts.length,
            "LOAS: bulk transferFrom args must be equals"
        );
        for (uint256 i; i < froms.length; i++) {
            transferFrom(froms[i], tos[i], amounts[i]);
        }
        return true;
    }

    /**
     * Get current amount of the LOAS available for conversion.
     * @param original Holder of the LOAS token.
     */
    function getClaimableOAS(address original) public view returns (uint256) {
        ClaimInfo memory originalClaimInfo = claimInfo[original];
        if (originalClaimInfo.amount == 0) {
            return 0;
        }
        if (block.timestamp < originalClaimInfo.since) {
            return 0;
        }
        uint256 amount = (originalClaimInfo.amount * (block.timestamp - originalClaimInfo.since)) /
            (originalClaimInfo.until - originalClaimInfo.since);
        if (amount > originalClaimInfo.amount) {
            return originalClaimInfo.amount;
        }
        return amount;
    }

    /**********************
     * Internal Functions *
     **********************/

    /**
     * The LOAS is transferable to allowed addresses.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 /*amount*/
    ) internal view override {
        if (from == address(0) || to == address(0)) return;
        if (originalClaimer[from] == originalClaimer[to]) return;

        revert UnauthorizedTransfer();
    }

    /**
     * Whether list of the address contains the item address.
     */
    function _contains(address[] memory list, address item) internal pure returns (bool) {
        for (uint256 index = 0; index < list.length; index++) {
            if (list[index] == item) {
                return true;
            }
        }
        return false;
    }

    /**
     * Allow the transferable address for the claimer address.
     */
    function _allow(address original, address allowed) internal {
        if (originalClaimer[allowed] != address(0)) revert AlreadyClaimer();

        originalClaimer[allowed] = original;

        emit Allow(original, allowed);
    }
}
