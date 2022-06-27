// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

library Token {
    /**
     * Type of tokens.
     *
     * OAS  - Native token of Oasys Blockchain
     * wOAS - Wrapperd OAS
     * sOAS - Stakable OAS
     */
    enum Type {
        OAS,
        wOAS,
        sOAS
    }

    // Wrapperd OAS
    IERC20 public constant WOAS = IERC20(0x5200000000000000000000000000000000000001);
    // Stakable OAS
    IERC20 public constant SOAS = IERC20(0x5200000000000000000000000000000000000002);

    /**
     * Receives Native or ERC20 tokens.
     * @param token Type of token to receive.
     * @param from Address of token holder.
     * @param amount Amount of token to receive.
     */
    function receives(
        Type token,
        address from,
        uint256 amount
    ) internal {
        if (token == Type.OAS) {
            require(msg.value == amount, "msg.value and amount not match.");
        } else {
            require(msg.value == 0, "msg.value must be zero.");
            require(_getERC20(token).transferFrom(from, address(this), amount), "ERC20 transfer failed.");
        }
    }

    /**
     * Transfers Native or ERC20 tokens.
     * @param token Type of token to transfer.
     * @param to Address of token recipient.
     * @param amount Amount of token to transfer.
     */
    function transfers(
        Type token,
        address to,
        uint256 amount
    ) internal {
        if (token == Type.OAS) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = to.call{ value: amount }(new bytes(0));
            require(success, "OAS transfer failed.");
        } else {
            require(_getERC20(token).transfer(to, amount), "ERC20 transfer failed.");
        }
    }

    function _getERC20(Type token) private pure returns (IERC20) {
        if (token == Type.wOAS) {
            return WOAS;
        } else if (token == Type.sOAS) {
            return SOAS;
        }
        revert("unsupported token.");
    }
}
