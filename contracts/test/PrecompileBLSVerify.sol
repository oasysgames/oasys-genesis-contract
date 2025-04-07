// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

contract PrecompileBLSVerify {
    bytes public returnValue;
    bool public flgRevert;
    // solhint-disable-next-line payable-fallback, no-complex-fallback
    fallback(bytes calldata /*output*/) external returns (bytes memory) {
        if (flgRevert) revert("execution reverted");
        return returnValue;
    }
    function set(bool returnValue_ , bool flgRevert_) external {
        returnValue = abi.encodePacked(returnValue_);
        flgRevert = flgRevert_;
    }
}
