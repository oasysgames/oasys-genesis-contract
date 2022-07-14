// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

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
            signers.push(_signers[i]);

            emit SignerAdded(_signers[i]);
        }

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
        uint256 signatureCount = signatures.length / 65;
        uint256 signerCount = 0;
        address lastSigner = address(0);
        for (uint256 i = 0; i < signatureCount; i++) {
            address _signer = recoverSigner(_hash, signatures, i * 65);
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
        bytes memory signatures,
        uint256 index
    ) private pure returns (address) {
        require(signatures.length >= index + 65, "Signatures size shortage");

        bytes32 r;
        bytes32 s;
        uint8 v;
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            r := mload(add(signatures, add(index, 32)))
            s := mload(add(signatures, add(index, 64)))
            v := and(255, mload(add(signatures, add(index, 65))))
        }
        if (v < 27) {
            v += 27;
        }
        require(v == 27 || v == 28, "v must be 27 or 28");

        _hash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash)
        );
        return ecrecover(_hash, v, r, s);
    }

    /**
     * Add the address into the signers.
     * @param _address Allowed address.
     */
    function addSigner(address _address, bytes memory signatures) external {
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
