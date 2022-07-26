// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { ERC721Enumerable } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SidechainERC721
 * @dev SidechainERC721 is the Oasys Standard NFT Bridge Contract.
 */
contract SidechainERC721 is ERC721, ERC721Enumerable, Ownable {
    /**********
     * Events *
     **********/

    event SidechainMint(address indexed account, uint256 tokenId);
    event SidechainBurn(address indexed account, uint256 tokenId);

    /**********************
     * Contract Variables *
     **********************/
    uint256 private mainchainId;
    address private mainchainERC721;

    /**
     * @param _mainchainId ID of the main chain.
     * @param _mainchainERC721 Address of the corresponding main chain ERC721.
     * @param _name ERC721 name.
     * @param _symbol ERC721 symbol.
     */
    constructor(
        uint256 _mainchainId,
        address _mainchainERC721,
        string memory _name,
        string memory _symbol
    ) ERC721(_name, _symbol) {
        mainchainId = _mainchainId;
        mainchainERC721 = _mainchainERC721;
    }

    function getMainchainERC721() external view returns (uint256, address) {
        return (mainchainId, mainchainERC721);
    }

    function mint(address to, uint256 tokenId) public virtual onlyOwner {
        _mint(to, tokenId);

        emit SidechainMint(to, tokenId);
    }

    function burn(address from, uint256 tokenId) public virtual onlyOwner {
        _burn(tokenId);

        emit SidechainBurn(from, tokenId);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal virtual override(ERC721, ERC721Enumerable) {
        super._beforeTokenTransfer(from, to, tokenId);
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
