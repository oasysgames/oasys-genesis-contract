// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

// Is a zero address.
error NullAddress();

// Unauthorized transaction sender.
error UnauthorizedSender();

// Epoch must be the future.
error PastEpoch();
