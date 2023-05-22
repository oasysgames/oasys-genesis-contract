// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import { OASMultiTransfer } from "../../util/OASMultiTransfer.sol";

contract TestOASMultiTransferReentrancy {
    string public reason;

    receive() external payable {
        if (msg.sender.balance == 0) return;

        address[] memory tos = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        tos[0] = address(this);
        amounts[0] = msg.sender.balance;

        (bool success, bytes memory data) = msg.sender.call(
            abi.encodeWithSelector(OASMultiTransfer.transfer.selector, tos, amounts)
        );
        if (success) return;

        assembly {
            data := add(data, 0x04)
        }
        reason = abi.decode(data, (string));
    }
}
