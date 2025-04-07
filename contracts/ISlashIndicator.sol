// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

/// @title ISlashIndicator
/// @notice Interface for the SlashIndicator contract, which handles misbehavior detection and slashing
interface ISlashIndicator {
    /// @notice Represents a single vote used to prove finality violations
    struct VoteData {
        uint256 srcNum;
        bytes32 srcHash;
        uint256 tarNum;
        bytes32 tarHash;
        bytes sig;
    }

    /// @notice Represents a pair of conflicting votes and the associated voter address
    struct FinalityEvidence {
        VoteData voteA;
        VoteData voteB;
        bytes voteAddr;
    }

    /// @notice Submits double-signing evidence for verification and slashing
    /// @param header1 RLP-encoded block header A
    /// @param header2 RLP-encoded block header B
    function submitDoubleSignEvidence(bytes calldata header1, bytes calldata header2) external;

    /// @notice Submits evidence of a finality violation for slashing
    /// @param evidence Struct containing two conflicting votes and the voter address
    function submitFinalityViolationEvidence(FinalityEvidence calldata evidence) external;
}
