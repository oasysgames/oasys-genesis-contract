// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import { INFTBridgeMainchain } from "./INFTBridgeMainchain.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract NFTBridgeMainchain is INFTBridgeMainchain, Ownable {
    /**********************
     * Contract Variables *
     **********************/

    DepositInfo[] private depositInfos;

    /********************
     * Public Functions *
     ********************/

    /**
     * Returns the DepositInfo.
     * @param depositIndex Index of the DepositInfo.
     */
    function getDepositInfo(uint256 depositIndex)
        external
        view
        returns (DepositInfo memory)
    {
        return depositInfos[depositIndex];
    }

    /**
     * Deposit the NFT to send to the side chain.
     * @param mainchainERC721 Address of the main chain ERC721.
     * @param tokenId TokenId of the NFT.
     * @param sidechainId Id of the side chain.
     * @param sideTo Destination address of the side chain.
     */
    function deposit(
        address mainchainERC721,
        uint256 tokenId,
        uint256 sidechainId,
        address sideTo
    ) external {
        IERC721(mainchainERC721).transferFrom(
            msg.sender,
            address(this),
            tokenId
        );
        depositInfos.push(
            DepositInfo(mainchainERC721, tokenId, msg.sender, address(0))
        );

        emit DepositeInitiated(
            depositInfos.length - 1,
            mainchainERC721,
            tokenId,
            sidechainId,
            msg.sender,
            sideTo
        );
    }

    /**
     * Reject the deposit by the Relayer
     * @param mainchainId Id of the main chain.
     * @param depositIndex Index of the DepositInfo.
     */
    function rejectDeposit(uint256 mainchainId, uint256 depositIndex)
        external
        onlyOwner
    {
        require(mainchainId == block.chainid, "Invalid main chain id.");

        DepositInfo storage mainInfo = depositInfos[depositIndex];
        require(mainInfo.mainTo == address(0), "already rejected");

        mainInfo.mainTo = mainInfo.mainFrom;
        IERC721(mainInfo.mainchainERC721).transferFrom(
            address(this),
            mainInfo.mainTo,
            mainInfo.tokenId
        );

        emit DepositeRejected(depositIndex);
    }

    /**
     * Finalize the withdrawal by the Relayer
     * @param mainchainId Id of the main chain.
     * @param depositIndex Index of the DepositInfo.
     * @param sidechainId Id of the side chain.
     * @param withdrawalIndex Index of the WithdrawalInfo.
     * @param sideFrom Source address of the side chain.
     * @param mainTo Destination address of the main chain.
     */
    function finalizeWithdrawal(
        uint256 mainchainId,
        uint256 depositIndex,
        uint256 sidechainId,
        uint256 withdrawalIndex,
        address sideFrom,
        address mainTo
    ) external onlyOwner {
        require(mainchainId == block.chainid, "Invalid main chain id.");

        DepositInfo storage mainInfo = depositInfos[depositIndex];
        require(mainInfo.mainTo == address(0), "already withdraw");

        mainInfo.mainTo = mainTo;
        try
            IERC721(mainInfo.mainchainERC721).safeTransferFrom(
                address(this),
                mainInfo.mainTo,
                mainInfo.tokenId
            )
        {
            emit WithdrawalFinalized(
                depositIndex,
                sidechainId,
                withdrawalIndex,
                mainInfo.mainchainERC721,
                sideFrom,
                mainTo
            );
        } catch {
            emit WithdrawalFailed(
                depositIndex,
                sidechainId,
                withdrawalIndex,
                mainInfo.mainchainERC721,
                sideFrom,
                mainTo
            );
        }
    }

    /**
     * Change the relayer
     * @param mainchainId Id of the main chain.
     * @param newRelayer Address of the new relayer.
     */
    function transferMainchainRelayer(uint256 mainchainId, address newRelayer)
        external
        onlyOwner
    {
        require(mainchainId == block.chainid, "Invalid main chain id.");
        super.transferOwnership(newRelayer);
    }
}
