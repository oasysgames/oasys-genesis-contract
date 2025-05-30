// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

contract PrecompileDoubleSign {
    bytes public returnValue;
    bool public flgRevert;
    // solhint-disable-next-line payable-fallback, no-complex-fallback
    fallback(bytes calldata /*evidence*/) external returns (bytes memory) {
        if (flgRevert) revert("execution reverted");
        return returnValue;
    }
    function set(address signer, uint256 evidenceHeight, bool flgRevert_) external {
        returnValue = abi.encodePacked(signer, evidenceHeight);
        flgRevert = flgRevert_;
    }
}
