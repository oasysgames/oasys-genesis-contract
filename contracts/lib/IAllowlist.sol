// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

/**
 * @title IAllowlist
 * @dev Allowlist interface.
 */
interface IAllowlist {
    /**********
     * Events *
     **********/

    event AllowlistAdded(address _address);
    event AllowlistRemoved(address _address);

    /********************
     * Public Functions *
     ********************/

    /**
     * Add the address into the allowlist.
     * @param _address Allowed address.
     */
    function addAddress(address _address) external;

    /**
     * Remove the address from the allowlist.
     * @param _address Removed address.
     */
    function removeAddress(address _address) external;

    /**
     * Returns the allowlist.
     */
    function getAllowlist() external view returns (address[] memory);

    /**
     * Check if the allowlist contains the address.
     * @param _address Target address.
     */
    function containsAddress(address _address) external view returns (bool);
}
