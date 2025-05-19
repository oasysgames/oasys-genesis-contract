// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import { ISlashIndicator } from "./ISlashIndicator.sol";
import { IEnvironment } from "./IEnvironment.sol";
import { IStakeManager } from "./IStakeManager.sol";
import { RLPEncode } from "./lib/RLPEncode.sol";
import { TypesToBytes } from "./lib/TypesToBytes.sol";
import { BytesLib } from "./lib/BytesLib.sol";
import { NullAddress, UnauthorizedSender, PastEpoch } from "./lib/Errors.sol";

/// @title SlashIndicator
/// @notice Handles slash-related logic including double-sign and finality violation detection
/// @dev Uses precompiled contracts to validate slashing evidence and BLS signatures
contract SlashIndicator is ISlashIndicator {
    using RLPEncode for *;

    /// @dev Penalty epoch period for double signing.
    uint256 public constant DOUBLE_SIGN_PENALTY_PERIOD = 3;

    /// @dev Penalty epoch period for finality violations.
    uint256 public constant FINALITY_VIOLATION_PENALTY_PERIOD = 1;

    /// @notice Environment contract providing chain parameters
    IEnvironment public immutable environment;

    /// @notice StakeManager contract handling slashing and jailing logic
    IStakeManager public immutable stakeManager;

    /// @notice Chain ID used in slashing evidence
    uint16 public immutable chainId;

    /// @param _environment Address of the environment contract
    /// @param _stakeManager Address of the stake manager contract
    /// @param chainId_ ID of the chain
    constructor(address _environment, address _stakeManager, uint16 chainId_) {
        if (_environment == address(0)) revert NullAddress();
        if (_stakeManager == address(0)) revert NullAddress();

        environment = IEnvironment(_environment);
        stakeManager = IStakeManager(_stakeManager);
        chainId = chainId_;
    }

    /// @inheritdoc ISlashIndicator
    function submitDoubleSignEvidence(bytes memory header1, bytes memory header2) public override {
        require(header1.length != 0 && header2.length != 0, "empty header");

        bytes[] memory elements = new bytes[](3);
        elements[0] = chainId.encodeUint();
        elements[1] = header1.encodeBytes();
        elements[2] = header2.encodeBytes();

        // call precompile contract to verify evidence
        bytes memory input = elements.encodeList();
        bytes memory output = new bytes(52);
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let len := mload(input)
            if iszero(staticcall(not(0), 0x68, add(input, 0x20), len, add(output, 0x20), 0x34)) { revert(0, 0) }
        }

        address signer;
        uint256 evidenceHeight;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            signer := mload(add(output, 0x14))
            evidenceHeight := mload(add(output, 0x34))
        }
        require(evidenceHeight + _slashScope() >= block.number, "evidence too old");

        // Jail the validator
        // Revert if the signer is not a validator
        stakeManager.jail(address(0), signer, new bytes(0), DOUBLE_SIGN_PENALTY_PERIOD);
    }

    /// @inheritdoc ISlashIndicator
    function submitFinalityViolationEvidence(FinalityEvidence memory _evidence) public override {
        // Basic check
        require(
            _evidence.voteA.tarNum + _slashScope() > block.number
                && _evidence.voteB.tarNum + _slashScope() > block.number,
            "target block too old"
        );
        require(
            !(_evidence.voteA.srcHash == _evidence.voteB.srcHash && _evidence.voteA.tarHash == _evidence.voteB.tarHash),
            "two identical votes"
        );
        require(
            _evidence.voteA.srcNum < _evidence.voteA.tarNum && _evidence.voteB.srcNum < _evidence.voteB.tarNum,
            "srcNum bigger than tarNum"
        );

        // Vote rules check
        require(
            (_evidence.voteA.srcNum < _evidence.voteB.srcNum && _evidence.voteB.tarNum < _evidence.voteA.tarNum)
                || (_evidence.voteB.srcNum < _evidence.voteA.srcNum && _evidence.voteA.tarNum < _evidence.voteB.tarNum)
                || _evidence.voteA.tarNum == _evidence.voteB.tarNum,
            "no violation of vote rules"
        );

        // BLS verification
        require(
            _verifyBLSSignature(_evidence.voteA, _evidence.voteAddr)
                && _verifyBLSSignature(_evidence.voteB, _evidence.voteAddr),
            "verify signature failed"
        );

        // Jail the validator
        // Revert if the signer is not a validator
        stakeManager.jail(address(0), address(0), _evidence.voteAddr, FINALITY_VIOLATION_PENALTY_PERIOD);
    }

    function _verifyBLSSignature(VoteData memory vote, bytes memory voteAddr) internal view returns (bool) {
        bytes[] memory elements = new bytes[](4);
        bytes memory _bytes = new bytes(32);
        elements[0] = vote.srcNum.encodeUint();
        TypesToBytes.bytes32ToBytes(32, vote.srcHash, _bytes);
        elements[1] = _bytes.encodeBytes();
        elements[2] = vote.tarNum.encodeUint();
        TypesToBytes.bytes32ToBytes(32, vote.tarHash, _bytes);
        elements[3] = _bytes.encodeBytes();

        TypesToBytes.bytes32ToBytes(32, keccak256(elements.encodeList()), _bytes);

        // assemble input data
        bytes memory input = new bytes(176);
        _bytesConcat(input, _bytes, 0, 32);
        _bytesConcat(input, vote.sig, 32, 96);
        _bytesConcat(input, voteAddr, 128, 48);

        // call the precompiled contract to verify the BLS signature
        // the precompiled contract's address is 0x66
        bytes memory output = new bytes(1);
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let len := mload(input)
            if iszero(staticcall(not(0), 0x66, add(input, 0x20), len, add(output, 0x20), 0x01)) { revert(0, 0) }
        }
        if (BytesLib.toUint8(output, 0) != uint8(1)) {
            return false;
        }
        return true;
    }

    function _bytesConcat(bytes memory data, bytes memory _bytes, uint256 index, uint256 len) internal pure {
        for (uint256 i; i < len; ++i) {
            data[index++] = _bytes[i];
        }
    }

    function _slashScope() internal view virtual returns (uint256) {
        return environment.value().epochPeriod;
    }

}