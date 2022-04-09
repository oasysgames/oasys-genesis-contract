// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

abstract contract System {
    bool public initialized;

    modifier initializer() {
        require(!initialized, "already initialized.");
        initialized = true;
        _;
    }

    modifier onlyCoinbase() {
        require(msg.sender == block.coinbase, "sender must be block producer.");
        _;
    }
}
