// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

/**
 * @title IAddressList
 * @dev AddressList interface.
 */
interface IAddressList {
    /**********
     * Events *
     **********/

    event Added(address indexed _address);
    event Removed(address indexed _address);

    /********************
     * Public Functions *
     ********************/

    /**
     * Add the address. If it already exists, do nothing.
     * @param _address New address.
     * @return result If true, the newly added.
     */
    function add(address _address) external returns (bool result);

    /**
     * Add multiple addresses.
     * @param addresses New addresses.
     * @return results List of results.
     */
    function adds(address[] calldata addresses) external returns (bool[] memory results);

    /**
     * Remove the address. If it does not exist, do nothing.
     * @param _address Removed address.
     * @return result If true, the removed.
     */
    function remove(address _address) external returns (bool result);

    /**
     * Remove multiple addresses.
     * @param addresses Removed addresses.
     * @return results List of results.
     */
    function removes(address[] calldata addresses) external returns (bool[] memory results);

    /**
     * Return the number of addresses.
     */
    function length() external view returns (uint256);

    /**
     * Check if contains the address.
     * @param _address Target address.
     */
    function has(address _address) external view returns (bool);

    /**
     * Returns the before address. Returns address(0) if the address does not exist.
     * @param _address Base address.
     */
    function prev(address _address) external view returns (address);

    /**
     * Return the after address. Returns address(0) if the address does not exist.
     * @param _address Base address.
     */
    function next(address _address) external view returns (address);

    /**
     * Returns address list.
     * @param cursor The index of the first item being requested.
     * @param howMany Indicates how many items should be returned.
     * @return addresses List of addresse .
     * @return newCursor Cursor that should be used in the next request.
     */
    function list(
        uint256 cursor,
        uint256 howMany
    ) external view returns (address[] memory addresses, uint256 newCursor);
}
