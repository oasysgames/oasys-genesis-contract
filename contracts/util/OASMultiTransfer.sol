// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

// Invalid argument.
error InvalidArgument();

// OAS transfer failed.
error TransferFailed(address to, uint256 amount);

/**
 * @title OASMultiTransfer
 * @dev Transfer multiple OAS at the one transaction
 */
contract OASMultiTransfer {
    /**
     * Multi transfer
     * @param tos List of receipient address.
     * @param amounts List of amount.
     */
    function transfer(address[] memory tos, uint256[] memory amounts) external payable {
        if (tos.length != amounts.length) revert InvalidArgument();

        for (uint256 i = 0; i < tos.length; i++) {
            if (tos[i] == address(0)) continue;
            if (amounts[i] == 0) continue;

            (bool transferSucceeded, ) = tos[i].call{ value: amounts[i] }("");
            if (!transferSucceeded) revert TransferFailed(tos[i], amounts[i]);
        }

        if (address(this).balance == 0) return;

        (bool refundSucceeded, ) = msg.sender.call{ value: address(this).balance }("");
        if (!refundSucceeded) revert TransferFailed(msg.sender, address(this).balance);
    }
}
