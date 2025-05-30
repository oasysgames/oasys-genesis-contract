// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

/// @title ISlashIndicator
/// @notice Interface for the SlashIndicator contract, which handles misbehavior detection and slashing
interface ISlashIndicator {

    /// @notice Thrown when a required header is empty or missing.
    error EmptyHeader();

    /// @notice Thrown when the evidence being submitted is from a block that is too old to be slashed.
    error EvidenceTooOld(uint256 evidenceHeight, uint256 currentBlock, uint256 slashScope);

    /// @notice Thrown when the target block numbers in two votes are both too old to be slashed.
    error TargetBlockTooOld(uint256 targetBlockA, uint256 targetBlockB, uint256 currentBlock, uint256 slashScope);

    /// @notice Thrown when both submitted votes are identical (i.e., not conflicting).
    error TwoIdenticalVotes();

    /// @notice Thrown when source number is greater than target number in a way that violates expectations.
    error SrcNumBiggerThanTarNum(uint256 srcNumA, uint256 tarNumA, uint256 srcNumB, uint256 tarNumB);

    /// @notice  Thrown when none of the vote conflict rules are violated (i.e., invalid evidence).
    error NoViolationOfVoteRules();

    /// @notice Thrown when signature verification of a vote fails.
    error VerifySignatureFailed();

    /// @notice Emitted when evidence of double-signing is submitted.
    event DoubleSignEvidenceSubmitted(
        address indexed signer,
        bytes header1,
        bytes header2,
        uint256 evidenceHeight,
        uint256 blockNumber
    );

    /// @notice Emitted when evidence of finality violation is submitted.
    event FinalityViolationEvidenceSubmitted(
        bytes voteAddr,
        VoteData voteA,
        VoteData voteB
    );

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
