// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import { IEnvironment } from "../IEnvironment.sol";

error PastEpoch();

/**
 * @title UpdateHistories
 */
library UpdateHistories {
    function add(
        uint256[] storage epochs,
        uint256[] storage values,
        uint256 epoch,
        uint256 value
    ) internal {
        uint256 length = epochs.length;
        if (length > 1 && epoch < epochs[length - 1] && epoch < epochs[length - 2]) revert PastEpoch();

        uint256 pos = extend(epochs, values, epoch);
        length = epochs.length;
        for (; pos < length; pos++) {
            values[pos] += value;
        }
    }

    function sub(
        uint256[] storage epochs,
        uint256[] storage values,
        uint256 epoch,
        uint256 value
    ) internal returns (uint256) {
        uint256 length = epochs.length;
        if (length == 0 || epoch < epochs[length - 1]) revert PastEpoch();

        uint256 pos = extend(epochs, values, epoch);
        uint256 balance = values[pos];
        value = value <= balance ? value : balance;
        if (value > 0) values[pos] -= value;
        return value;
    }

    function find(
        uint256[] storage epochs,
        uint256[] storage values,
        uint256 epoch
    ) internal view returns (uint256) {
        uint256 length = epochs.length;
        if (length == 0 || epochs[0] > epoch) return 0;
        if (epochs[length - 1] <= epoch) return values[length - 1];
        if (length > 1 && epochs[length - 2] <= epoch) return values[length - 2];
        uint256 idx = sBinarySearch(epochs, epoch, 0, length);
        return values[idx];
    }

    function find(
        uint256[] memory epochs,
        IEnvironment.EnvironmentValue[] memory values,
        uint256 epoch
    ) internal pure returns (IEnvironment.EnvironmentValue memory) {
        uint256 length = epochs.length;
        if (epochs[length - 1] <= epoch) return values[length - 1];
        if (length > 1 && epochs[length - 2] <= epoch) return values[length - 2];
        uint256 idx = mBinarySearch(epochs, epoch, 0, length);
        return values[idx];
    }

    function extend(
        uint256[] storage epochs,
        uint256[] storage values,
        uint256 epoch
    ) internal returns (uint256 pos) {
        uint256 length = epochs.length;

        // first time
        if (length == 0) {
            epochs.push(epoch);
            values.push(0);
            return 0;
        }

        uint256 lastPos = length - 1;
        uint256 lastEpoch = epochs[lastPos];

        // same as last epoch
        if (epoch == lastEpoch) return lastPos;

        // future epoch
        if (epoch > lastEpoch) {
            epochs.push(epoch);
            values.push(values[lastPos]);
            return lastPos + 1;
        }

        // previous epoch
        if (lastPos > 0 && epoch == epochs[lastPos - 1]) {
            return lastPos - 1;
        } else {
            epochs.push(epochs[lastPos]);
            values.push(values[lastPos]);
            epochs[lastPos] = epoch;
            values[lastPos] = lastPos == 0 ? 0 : values[lastPos - 1];
            return lastPos;
        }
    }

    function sBinarySearch(
        uint256[] storage epochs,
        uint256 epoch,
        uint256 head,
        uint256 tail
    ) internal view returns (uint256) {
        if (head == tail) return tail - 1;
        uint256 center = (head + tail) / 2;
        if (epochs[center] > epoch) return sBinarySearch(epochs, epoch, head, center);
        if (epochs[center] < epoch) return sBinarySearch(epochs, epoch, center + 1, tail);
        return center;
    }

    function mBinarySearch(
        uint256[] memory epochs,
        uint256 epoch,
        uint256 head,
        uint256 tail
    ) internal pure returns (uint256) {
        if (head == tail) return tail - 1;
        uint256 center = (head + tail) / 2;
        if (epochs[center] > epoch) return mBinarySearch(epochs, epoch, head, center);
        if (epochs[center] < epoch) return mBinarySearch(epochs, epoch, center + 1, tail);
        return center;
    }
}
