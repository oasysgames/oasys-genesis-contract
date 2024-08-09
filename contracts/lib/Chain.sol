// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import { Constants } from "./Constants.sol";

/**
 * @title Chain
 */
library Chain {
    /**
     * @dev Returns true if the current chain is the Oasys Mainnet.
     */
    function isMainnet() internal view returns (bool) {
        return block.chainid == Constants.MAINNET_CHAIN_ID;
    }

    /**
     * @dev Returns true if the current chain is the Oasys Testnet.
     */
    function isTestnet() internal view returns (bool) {
        return block.chainid == Constants.TESTNET_CHAIN_ID;
    }
}
