// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { NullAddress, UnauthorizedSender } from "./lib/Errors.sol";

/**
 * @title TransactionBlocker
 * @notice A contract that manages blocked addresses and global blocking state.
 */
contract TransactionBlocker is AccessControl {

    /// @notice Error thrown when attempting to block an empty array
    error EmptyArray();

    /// @notice Error thrown when attempting to block an address that is already blocked
    error AlreadyBlocked();

    /// @notice Error thrown when attempting to unblock an address that is not currently blocked
    error NotBlocked();

    /// @notice Role identifier for operators who can manage blocked addresses
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // Slot number is `0`.
    // Defined in the @openzeppelin/contracts/access/AccessControl.sol
    // mapping(bytes32 => RoleData) private _roles;

    /// @notice Global flag indicating whether all transactions are blocked
    /// @dev Slot number is `1`. Don't change. Hardcoded in the oasys-validator side.
    bool public isBlockedAll;

    /// @notice Mapping to track which addresses are blocked (both from/to directions)
    /// @notice The value is the index + 1 of the address in the blockedAddresses array
    /// @notice If the address is not blocked, the value is 0
    /// @dev Slot number is `2`. Don't change. Hardcoded in the oasys-validator side.
    mapping(address => uint256) private _isBlockedAddress;

    /// @notice Array of all currently blocked addresses
    address[] public blockedAddresses;

    /// @notice Emitted when an address is added to the blocked list
    /// @param addr The address that was blocked
    event BlockedAddressAdded(address addr);

    /// @notice Emitted when an address is removed from the blocked list
    /// @param addr The address that was unblocked
    event BlockedAddressRemoved(address addr);

    /// @notice Emitted when the global blocking state is changed
    /// @param isBlockedAll The new global blocking state
    event BlockedAllSet(bool isBlockedAll);

    /// @notice Modifier that restricts function access to operators only
    modifier onlyOperator() {
        if (!hasRole(OPERATOR_ROLE, msg.sender)) revert UnauthorizedSender();
        _;
    }

    /**
     * @notice Initializes the contract with admin and operator roles
     * @param admins Array of addresses to be granted the DEFAULT_ADMIN_ROLE
     * @param operators Array of addresses to be granted the OPERATOR_ROLE
     * @dev Reverts if any provided address is the zero address
     */
    constructor(address[] memory admins, address[] memory operators) {
        for (uint256 i = 0; i < admins.length; ++i) {
            if (admins[i] == address(0)) revert NullAddress();
            _grantRole(DEFAULT_ADMIN_ROLE, admins[i]);
        }
        for (uint256 i = 0; i < operators.length; ++i) {
            if (operators[i] == address(0)) revert NullAddress();
            _grantRole(OPERATOR_ROLE, operators[i]);
        }
    }

    /**
     * @notice Sets the global blocking state for all transactions
     * @param _isBlockedAll True to block all transactions, false to allow transactions (subject to address-level blocking)
     * @dev Only callable by operators
     */
    function setBlockedAll(bool _isBlockedAll) external onlyOperator {
        isBlockedAll = _isBlockedAll;
        emit BlockedAllSet(_isBlockedAll);
    }

    /**
     * @notice Blocks a single address from executing transactions
     * @param addr The address to block
     * @dev Only callable by operators. Reverts if address is already blocked or is the zero address.
     */
    function blockAddress(address addr) external onlyOperator {
        _addBlockedAddress(addr);
    }

    /**
     * @notice Blocks multiple addresses from executing transactions in a single transaction
     * @param addrs Array of addresses to block
     * @dev Only callable by operators. Reverts if any address is already blocked or is the zero address.
     */
    function bulkBlockAddresses(address[] memory addrs) external onlyOperator {
        if (addrs.length == 0) revert EmptyArray();
        for (uint256 i = 0; i < addrs.length; ++i) {
            _addBlockedAddress(addrs[i]);
        }
    }

    /**
     * @notice Unblocks a single address, allowing it to execute transactions again
     * @param addr The address to unblock
     * @dev Only callable by operators. Reverts if address is not currently blocked or is the zero address.
     */
    function unblockAddress(address addr) external onlyOperator {
        _removeBlockedAddress(addr);
    }

    /**
     * @notice Unblocks multiple addresses in a single transaction
     * @param addrs Array of addresses to unblock
     * @dev Only callable by operators. Reverts if any address is not currently blocked or is the zero address.
     */
    function bulkUnblockAddresses(address[] memory addrs) external onlyOperator {
        if (addrs.length == 0) revert EmptyArray();
        for (uint256 i = 0; i < addrs.length; ++i) {
            _removeBlockedAddress(addrs[i]);
        }
    }

    /**
     * @notice Checks if an address is blocked
     * @param addr The address to check
     * @return True if the address is blocked, false otherwise
     */
    function isBlockedAddress(address addr) public view returns (bool) {
        return _isBlockedAddress[addr] > 0;
    }

    /**
     * @notice Returns the list of all currently blocked addresses
     * @return Array of blocked addresses
     */
    function getBlockedAddresses() external view returns (address[] memory) {
        return blockedAddresses;
    }

    /**
     * @notice Internal function to add an address to the blocked list
     * @param addr The address to block
     * @dev Reverts if address is zero or already blocked. Adds address to both mapping and array.
     */
    function _addBlockedAddress(address addr) internal {
        if (addr == address(0)) revert NullAddress();
        if (isBlockedAddress(addr)) revert AlreadyBlocked();
        blockedAddresses.push(addr);
        _isBlockedAddress[addr] = blockedAddresses.length;
        emit BlockedAddressAdded(addr);
    }

    /**
     * @notice Internal function to remove an address from the blocked list
     * @param addr The address to unblock
     * @dev Reverts if address is zero or not currently blocked.
     *      Uses swap-and-pop pattern to efficiently remove from array.
     */
    function _removeBlockedAddress(address addr) internal {
        if (addr == address(0)) revert NullAddress();
        if (!isBlockedAddress(addr)) revert NotBlocked();

        uint256 arrayIndex = _isBlockedAddress[addr] - 1;
        address last = blockedAddresses[blockedAddresses.length - 1];

        blockedAddresses.pop();
        delete _isBlockedAddress[addr];

        // Swap the target address with the last address, unless it's already the last
        if (last != addr) {
            blockedAddresses[arrayIndex] = last;
            _isBlockedAddress[last] = arrayIndex + 1;
        }

        emit BlockedAddressRemoved(addr);
    }
}