// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

// Copy of the this library from the bsc-genesis-contract
// https://github.com/bnb-chain/bsc-genesis-contract/blob/v1.2.4/contracts/lib/BytesLib.sol
library BytesLib {
    function toUint8(bytes memory _bytes, uint256 _start) internal pure returns (uint8) {
        // solhint-disable-next-line reason-string
        require(_bytes.length >= (_start + 1));
        uint8 tempUint;

        // solhint-disable-next-line no-inline-assembly
        assembly {
            tempUint := mload(add(add(_bytes, 0x1), _start))
        }

        return tempUint;
    }
}
