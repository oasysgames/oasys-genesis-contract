// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import { INFTBridgeSidechain } from "./INFTBridgeSidechain.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { SidechainERC721 } from "./SidechainERC721.sol";

contract NFTBridgeSidechain is INFTBridgeSidechain, Ownable {
    /**********************
     * Contract Variables *
     **********************/

    mapping(uint256 => mapping(address => address)) private erc721Map;
    mapping(uint256 => mapping(uint256 => bool)) private depositIndexes;
    mapping(address => mapping(uint256 => uint256)) private depositIndexMap;
    WithdrawalInfo[] private withdrawalInfos;

    /********************
     * Public Functions *
     ********************/

    /**
     * Returns the Side chain ERC721.
     * @param mainchainId Id of the main chain.
     * @param mainchainERC721 Address of the main chain ERC721.
     */
    function getSidechainERC721(uint256 mainchainId, address mainchainERC721)
        public
        view
        returns (address)
    {
        return erc721Map[mainchainId][mainchainERC721];
    }

    /**
     * Returns the WithdrawalInfo.
     * @param withdrawalIndex Index of the WithdrawalInfo.
     */
    function getWithdrawalInfo(uint256 withdrawalIndex)
        external
        view
        returns (WithdrawalInfo memory)
    {
        return withdrawalInfos[withdrawalIndex];
    }

    /**
     * Create new ERC721 corresponding to the main chain
     * @param sidechainId Id of the sidechain.
     * @param mainchainId Id of the mainchain.
     * @param mainchainERC721 Address of the mainchain ERC721.
     * @param name Name of the NFT
     * @param symbol Symbol of the NFT
     */
    function createSidechainERC721(
        uint256 sidechainId,
        uint256 mainchainId,
        address mainchainERC721,
        string memory name,
        string memory symbol
    ) external onlyOwner {
        require(sidechainId == block.chainid, "Invalid side chain id");
        require(mainchainId != sidechainId, "Same chain id");

        require(
            getSidechainERC721(mainchainId, mainchainERC721) == address(0),
            "SideChainERC721 already exists"
        );

        SidechainERC721 sidechainERC721 = new SidechainERC721(
            mainchainId,
            mainchainERC721,
            name,
            symbol
        );
        erc721Map[mainchainId][mainchainERC721] = address(sidechainERC721);

        emit SidechainERC721Created(
            mainchainId,
            mainchainERC721,
            address(sidechainERC721),
            name,
            symbol
        );
    }

    /**
     * Finalize the deposit by the Relayer
     * @param sidechainId Id of the sidechain.
     * @param mainchainId Id of the mainchain.
     * @param depositIndex Index of the DepositInfo.
     * @param mainchainERC721 Address of the mainchain ERC721.
     * @param tokenId TokenId of the NFT.
     * @param mainFrom Source address of the mainchain.
     * @param sideTo Destination address of the sidechain.
     */
    function finalizeDeposit(
        uint256 sidechainId,
        uint256 mainchainId,
        uint256 depositIndex,
        address mainchainERC721,
        uint256 tokenId,
        address mainFrom,
        address sideTo
    ) external onlyOwner {
        require(sidechainId == block.chainid, "Invalid side chain id");

        address sidechainERC721 = getSidechainERC721(
            mainchainId,
            mainchainERC721
        );
        if (sidechainERC721 == address(0)) {
            emit DepositeFailed(
                mainchainId,
                depositIndex,
                mainchainERC721,
                sidechainERC721,
                tokenId,
                mainFrom,
                sideTo
            );
            return;
        }

        require(
            !depositIndexes[mainchainId][depositIndex],
            "Already deposited"
        );
        depositIndexes[mainchainId][depositIndex] = true;
        depositIndexMap[sidechainERC721][tokenId] = depositIndex;

        try SidechainERC721(sidechainERC721).mint(sideTo, tokenId) {
            emit DepositeFinalized(
                mainchainId,
                depositIndex,
                mainchainERC721,
                sidechainERC721,
                tokenId,
                mainFrom,
                sideTo
            );
        } catch {
            emit DepositeFailed(
                mainchainId,
                depositIndex,
                mainchainERC721,
                sidechainERC721,
                tokenId,
                mainFrom,
                sideTo
            );
        }
    }

    /**
     * Withdraw the NFT to send to the mainchain.
     * @param sidechainERC721 Address of the sidechain ERC721.
     * @param tokenId TokenId of the NFT.
     * @param mainTo Destination address of the mainchain.
     */
    function withdraw(
        address sidechainERC721,
        uint256 tokenId,
        address mainTo
    ) external {
        (uint256 mainchainId, address mainchainERC721) = SidechainERC721(
            sidechainERC721
        ).getMainchainERC721();
        require(
            sidechainERC721 == getSidechainERC721(mainchainId, mainchainERC721),
            "Invalid sidechainERC721"
        );

        SidechainERC721(sidechainERC721).burn(msg.sender, tokenId);
        withdrawalInfos.push(
            WithdrawalInfo(sidechainERC721, tokenId, msg.sender, false)
        );

        emit WithdrawalInitiated(
            withdrawalInfos.length - 1,
            mainchainId,
            depositIndexMap[sidechainERC721][tokenId],
            mainchainERC721,
            sidechainERC721,
            tokenId,
            msg.sender,
            mainTo
        );
    }

    /**
     * Reject the withdrawal by the Relayer
     * @param sidechainId Id of the sidechain.
     * @param withdrawalIndex Index of the DepositInfo.
     */
    function rejectWithdrawal(uint256 sidechainId, uint256 withdrawalIndex)
        external
        onlyOwner
    {
        require(sidechainId == block.chainid, "Invalid side chain id");

        WithdrawalInfo storage sideWithdrawal = withdrawalInfos[
            withdrawalIndex
        ];
        require(!sideWithdrawal.rejected, "Already rejected");
        sideWithdrawal.rejected = true;

        SidechainERC721(sideWithdrawal.sidechainERC721).mint(
            sideWithdrawal.sideFrom,
            sideWithdrawal.tokenId
        );

        (uint256 mainchainId, ) = SidechainERC721(
            sideWithdrawal.sidechainERC721
        ).getMainchainERC721();
        emit WithdrawalRejected(
            withdrawalIndex,
            mainchainId,
            depositIndexMap[sideWithdrawal.sidechainERC721][
                sideWithdrawal.tokenId
            ]
        );
    }

    /**
     * Change the relayer
     * @param sidechainId Id of the sidechain.
     * @param newRelayer Address of the new relayer.
     */
    function transferSidechainRelayer(uint256 sidechainId, address newRelayer)
        external
        onlyOwner
    {
        require(sidechainId == block.chainid, "Invalid side chain id");
        super.transferOwnership(newRelayer);
    }
}
