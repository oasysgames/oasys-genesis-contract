// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IAddressList } from "./IAddressList.sol";
import { NullAddress } from "./Errors.sol";

/**
 * @title AddressList
 * @dev Manage addresses without duplication.
 */
contract AddressList is IAddressList, Ownable {
    mapping(address => uint256) private _ids;
    address[] private _addresses;

    /********************
     * Public functions *
     ********************/

    /**
     * @inheritdoc IAddressList
     */
    function add(address _address) external onlyOwner returns (bool result) {
        return _add(_address);
    }

    /**
     * @inheritdoc IAddressList
     */
    function adds(address[] calldata addresses) external onlyOwner returns (bool[] memory results) {
        uint256 _length = addresses.length;
        results = new bool[](_length);
        for (uint256 i = 0; i < _length; i++) {
            results[i] = _add(addresses[i]);
        }
        return results;
    }

    /**
     * @inheritdoc IAddressList
     */
    function remove(address _address) external onlyOwner returns (bool result) {
        return _remove(_address);
    }

    /**
     * @inheritdoc IAddressList
     */
    function removes(address[] calldata addresses) external onlyOwner returns (bool[] memory results) {
        uint256 _length = addresses.length;
        results = new bool[](_length);
        for (uint256 i = 0; i < _length; i++) {
            results[i] = _remove(addresses[i]);
        }
        return results;
    }

    /**
     * @inheritdoc IAddressList
     */
    function length() external view returns (uint256) {
        return _addresses.length;
    }

    /**
     * @inheritdoc IAddressList
     */
    function has(address _address) external view returns (bool) {
        return _ids[_address] > 0;
    }

    /**
     * @inheritdoc IAddressList
     */
    function prev(address _address) external view returns (address) {
        uint256 id = _ids[_address];
        return id >= 2 ? _addresses[id - 2] : address(0);
    }

    /**
     * @inheritdoc IAddressList
     */
    function next(address _address) external view returns (address) {
        uint256 id = _ids[_address];
        return id >= 1 && id < _addresses.length ? _addresses[id] : address(0);
    }

    /**
     * @inheritdoc IAddressList
     */
    function list(
        uint256 cursor,
        uint256 howMany
    ) external view returns (address[] memory addresses, uint256 newCursor) {
        uint256 _length = _addresses.length;
        if (cursor + howMany >= _length) {
            howMany = _length - cursor;
        }
        newCursor = cursor + howMany;

        addresses = new address[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            addresses[i] = _addresses[cursor + i];
        }

        return (addresses, newCursor);
    }

    /*********************
     * Private functions *
     *********************/

    function _add(address _address) internal returns (bool result) {
        if (_address == address(0)) revert NullAddress();

        uint256 _id = _ids[_address];
        if (_id != 0) return false;

        _addresses.push(_address);
        _ids[_address] = _addresses.length;

        emit Added(_address);

        return true;
    }

    function _remove(address _address) internal returns (bool result) {
        if (_address == address(0)) revert NullAddress();

        uint256 _id = _ids[_address];
        if (_id == 0) return false;

        // delete id
        _ids[_address] = 0;

        // pop the last
        address last = _addresses[_addresses.length - 1];
        _addresses.pop();

        // replace
        if (last != _address) {
            _ids[last] = _id;
            _addresses[_id - 1] = last;
        }

        emit Removed(_address);

        return true;
    }
}
