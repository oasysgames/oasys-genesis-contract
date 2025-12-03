// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import { NullAddress, UnauthorizedSender } from "./lib/Errors.sol";

/**
 * @title TransactionBlocker
 * @notice A contract manages blocked addresses and global blocking state.
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

    /// @notice Global flag indicating whether all transactions are blocked
    bool public isBlockedAll;

    /// @notice Mapping to track which addresses are blocked
    /// @notice Both from/to direction are blocked
    mapping(address => bool) public isBlockedAddress;

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
            _setupRole(DEFAULT_ADMIN_ROLE, admins[i]);
        }
        for (uint256 i = 0; i < operators.length; ++i) {
            if (operators[i] == address(0)) revert NullAddress();
            _setupRole(OPERATOR_ROLE, operators[i]);
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
        if (isBlockedAddress[addr]) revert AlreadyBlocked();
        isBlockedAddress[addr] = true;
        blockedAddresses.push(addr);
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
        if (!isBlockedAddress[addr]) revert NotBlocked();
        delete isBlockedAddress[addr];
        for (uint256 i = 0; i < blockedAddresses.length; ++i) {
            if (blockedAddresses[i] == addr) {
                blockedAddresses[i] = blockedAddresses[blockedAddresses.length - 1];
                break;
            }
        }
        blockedAddresses.pop();
        emit BlockedAddressRemoved(addr);
    }
}