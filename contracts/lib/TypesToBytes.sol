// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

// Copy of the this library from the bsc-genesis-contract
// https://github.com/bnb-chain/bsc-genesis-contract/blob/v1.2.4/contracts/lib/TypesToBytes.sol
library TypesToBytes {
    function bytes32ToBytes(uint256 _offst, bytes32 _input, bytes memory _output) internal pure {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mstore(add(_output, _offst), _input)
            mstore(add(add(_output, _offst), 32), add(_input, 32))
        }
    }
}
