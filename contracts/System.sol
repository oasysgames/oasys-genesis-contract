// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

/**
 * @title System
 */
abstract contract System {
    bool public initialized;

    /**
     * @dev Modifier requiring the initialize function to be called only once.
     */
    modifier initializer() {
        require(!initialized, "already initialized.");
        initialized = true;
        _;
    }

    /**
     * @dev Modifier requiring the sender to be validator of created this block.
     */
    modifier onlyCoinbase() {
        require(msg.sender == block.coinbase, "sender must be block producer.");
        _;
    }
}
