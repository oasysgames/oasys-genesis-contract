// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { BytesLib } from "solidity-bytes-utils/contracts/BytesLib.sol";

contract Signers {
    /**********
     * Events *
     **********/

    event SignerAdded(address _address);
    event SignerRemoved(address _address);
    event ThresholdUpdated(uint256 _threshold);

    /**********************
     * Contract Variables *
     **********************/

    uint256 public nonce;
    address[] private signers;
    uint256 public threshold;

    /***************
     * Constructor *
     ***************/

    constructor(address[] memory _signers, uint256 _threshold) {
        for (uint256 i = 0; i < _signers.length; i++) {
            address signer = _signers[i];
            require(signer != address(0), "Signer is zero address.");
            require(!_contains(signers, signer), "Duplicate signer.");

            signers.push(signer);

            emit SignerAdded(signer);
        }

        require(_threshold > 0, "Threshold is zero.");
        require(signers.length >= _threshold, "Signer shortage.");
        threshold = _threshold;

        emit ThresholdUpdated(_threshold);
    }

    /********************
     * Public Functions *
     ********************/

    function verifySignatures(bytes32 _hash, bytes memory signatures)
        public
        view
        returns (bool)
    {
        require(_hash != 0x0, "Hash is empty");
        require(signatures.length % 65 == 0, "Invalid signatures length");

        uint256 signatureCount = signatures.length / 65;
        uint256 signerCount = 0;
        address lastSigner = address(0);
        uint256 chainid = block.chainid;
        for (uint256 i = 0; i < signatureCount; i++) {
            address _signer = recoverSigner(_hash, chainid, signatures, i * 65);
            if (_contains(signers, _signer)) {
                signerCount++;
            }

            require(_signer > lastSigner, "Invalid address sort");
            lastSigner = _signer;
        }

        return signerCount >= threshold;
    }

    function recoverSigner(
        bytes32 _hash,
        uint256 chainid,
        bytes memory signatures,
        uint256 index
    ) private pure returns (address) {
        require(signatures.length >= index + 65, "Signatures size shortage");

        _hash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n64", _hash, chainid)
        );
        (address recovered, ) = ECDSA.tryRecover(
            _hash,
            BytesLib.slice(signatures, index, 65)
        );
        return recovered;
    }

    /**
     * Add the address into the signers.
     * @param _address Allowed address.
     */
    function addSigner(address _address, bytes memory signatures) external {
        require(_address != address(0), "Signer is zero address.");

        bytes32 _hash = keccak256(
            abi.encodePacked(
                nonce,
                address(this),
                abi.encodeWithSelector(Signers.addSigner.selector, _address)
            )
        );
        require(verifySignatures(_hash, signatures), "Invalid signatures");

        require(!_contains(signers, _address), "already added");
        signers.push(_address);

        nonce++;
        emit SignerAdded(_address);
    }

    /**
     * Remove the address from the signers.
     * @param _address Removed address.
     */
    function removeSigner(address _address, bytes memory signatures) external {
        bytes32 _hash = keccak256(
            abi.encodePacked(
                nonce,
                address(this),
                abi.encodeWithSelector(Signers.removeSigner.selector, _address)
            )
        );
        require(verifySignatures(_hash, signatures), "Invalid signatures");

        require(_contains(signers, _address), "address not found");

        uint256 length = signers.length;
        require(length - 1 >= threshold, "Signer shortage.");

        bool addressMatched = false;
        for (uint256 i = 0; i < length - 1; i++) {
            if (!addressMatched && signers[i] == _address) {
                addressMatched = true;
            }
            if (addressMatched) {
                signers[i] = signers[i + 1];
            }
        }
        signers.pop();

        nonce++;
        emit SignerRemoved(_address);
    }

    /**
     * Update the verification threshold.
     * @param _threshold Verification threshold.
     */
    function updateThreshold(uint256 _threshold, bytes memory signatures)
        external
    {
        require(_threshold > 0, "Threshold is zero.");

        if (threshold == _threshold) {
            return;
        }

        bytes32 _hash = keccak256(
            abi.encodePacked(
                nonce,
                address(this),
                abi.encodeWithSelector(
                    Signers.updateThreshold.selector,
                    _threshold
                )
            )
        );
        require(verifySignatures(_hash, signatures), "Invalid signatures");

        require(signers.length >= _threshold, "Signer shortage.");
        threshold = _threshold;

        nonce++;
        emit ThresholdUpdated(_threshold);
    }

    /**
     * Returns the allowlist.
     */
    function getSigners() external view returns (address[] memory) {
        return signers;
    }

    /**********************
     * Internal Functions *
     **********************/

    /**
     * Check if the array of address contains the address.
     * @param _addresses Array of address.
     * @param _address address.
     * @return Contains of not.
     */
    function _contains(address[] memory _addresses, address _address)
        internal
        pure
        returns (bool)
    {
        uint256 length = _addresses.length;
        for (uint256 i = 0; i < length; i++) {
            if (_addresses[i] == _address) {
                return true;
            }
        }
        return false;
    }
}
