import abi from 'web3-eth-abi'
import { ethers } from 'hardhat'
import { ContractFactory, Contract } from 'ethers'
import { SignerWithAddress as Account } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { chainid as mainchainId, makeSignature, zeroAddress } from '../helpers'

const sidechainId = 33333
const tokenId = 1
const depositIndex = 0
const withdrawalIndex = 0

const getRejectDepositHash = (mainchainId: number, depositIndex: number) => {
  const fsig = abi.encodeFunctionSignature('rejectDeposit(uint256,uint256)')
  const psig = abi.encodeParameters(['uint256', 'uint256'], [mainchainId, depositIndex])
  const hash = ethers.utils.keccak256(fsig + psig.slice(2))
  return hash
}

const getFinalizeWithdrawalHash = (
  mainchainId: number,
  depositIndex: number,
  sidechainId: number,
  withdrawalIndex: number,
  sideFrom: string,
  mainTo: string,
) => {
  const types = 'uint256,uint256,uint256,uint256,address,address'
  const fsig = abi.encodeFunctionSignature(`finalizeWithdrawal(${types})`)
  const psig = abi.encodeParameters(types.split(','), [
    mainchainId,
    depositIndex,
    sidechainId,
    withdrawalIndex,
    sideFrom,
    mainTo,
  ])
  const hash = ethers.utils.keccak256(fsig + psig.slice(2))
  return hash
}

const getTransferMainchainRelayerHash = (mainchainId: number, newRelayer: string) => {
  const fsig = abi.encodeFunctionSignature('transferMainchainRelayer(uint256,address)')
  const psig = abi.encodeParameters(['uint256', 'address'], [mainchainId, newRelayer])
  const hash = ethers.utils.keccak256(fsig + psig.slice(2))
  return hash
}

describe('NFTBridgeMainchain', () => {
  let accounts: Account[]
  let deployer: Account
  let signer: Account
  let user: Account
  let sideTo: Account

  let bridgeFactory: ContractFactory
  let relayerFactory: ContractFactory
  let tokenFactory: ContractFactory

  let bridge: Contract
  let relayer: Contract
  let token: Contract

  const mint = async () => {
    return token.connect(deployer).mint(user.address, tokenId)
  }

  const deposit = async () => {
    await token.connect(user).approve(bridge.address, tokenId)
    return bridge.connect(user).deposit(token.address, tokenId, sidechainId, sideTo.address)
  }

  before(async () => {
    accounts = await ethers.getSigners()
    deployer = accounts[1]
    signer = accounts[2]
    user = accounts[3]
    sideTo = accounts[3]

    bridgeFactory = await ethers.getContractFactory('NFTBridgeMainchain')
    relayerFactory = await ethers.getContractFactory('NFTBridgeRelayer')
    tokenFactory = await ethers.getContractFactory('TestERC721')
  })

  beforeEach(async () => {
    bridge = await bridgeFactory.connect(deployer).deploy()
    relayer = await relayerFactory.connect(deployer).deploy(bridge.address, zeroAddress, [signer.address], 1)
    token = await tokenFactory.connect(deployer).deploy('test token', 'tt')

    await bridge.connect(deployer).transferMainchainRelayer(mainchainId, relayer.address)
  })

  it('depositInfos()', async () => {
    await mint()
    await deposit()

    const actual = await bridge.getDepositInfo(0)
    expect(actual.mainchainERC721).to.equal(token.address)
    expect(actual.tokenId).to.equal(tokenId)
    expect(actual.mainFrom).to.equal(user.address)
    expect(actual.mainTo).to.equal(zeroAddress)
  })

  it('deposit()', async () => {
    await mint()
    expect(await token.ownerOf(tokenId)).to.equal(user.address)

    const tx = await deposit()
    expect(await token.ownerOf(tokenId)).to.equal(bridge.address)
    await expect(tx)
      .to.emit(bridge, 'DepositeInitiated')
      .withArgs(0, token.address, tokenId, sidechainId, user.address, user.address)
  })

  describe('rejectDeposit()', () => {
    const rejectDeposit = async (_mainchainId?: number) => {
      const hash = getRejectDepositHash(_mainchainId ?? mainchainId, depositIndex)
      const signatures = await makeSignature(signer, hash, mainchainId)
      return relayer.connect(user).rejectDeposit(_mainchainId ?? mainchainId, depositIndex, signatures)
    }

    it('normally', async () => {
      await mint()
      await deposit()
      expect(await token.ownerOf(tokenId)).to.equal(bridge.address)

      const tx = await rejectDeposit()
      expect(await token.ownerOf(tokenId)).to.equal(user.address)
      await expect(tx).to.emit(bridge, 'DepositeRejected').withArgs(depositIndex)
    })

    it('invalid chain id', async () => {
      await mint()
      await deposit()
      const tx = rejectDeposit(12345)
      await expect(tx).to.be.revertedWith('Invalid main chain id.')
    })

    it('already rejected', async () => {
      await mint()
      await deposit()
      await rejectDeposit()
      const tx = rejectDeposit()
      await expect(tx).to.be.revertedWith('already rejected')
    })

    it('failed token transfer', async () => {
      const to = '0xbeAfbeafbEAFBeAFbeAFBEafBEAFbeaFBEAfbeaF'

      await mint()
      await deposit()

      await token.forceTransfer(to, tokenId)
      expect(await token.ownerOf(tokenId)).to.equal(to)

      const tx = await rejectDeposit()
      expect(await token.ownerOf(tokenId)).to.equal(to)
      await expect(tx).to.emit(bridge, 'DepositeRejectFailed').withArgs(depositIndex)
    })
  })

  describe('finalizeWithdrawal()', () => {
    const finalizeWithdrawal = async (_mainchainId?: number) => {
      const hash = getFinalizeWithdrawalHash(
        _mainchainId ?? mainchainId,
        depositIndex,
        sidechainId,
        withdrawalIndex,
        user.address,
        user.address,
      )
      const signatures = await makeSignature(signer, hash, mainchainId)
      return relayer.finalizeWithdrawal(
        _mainchainId ?? mainchainId,
        depositIndex,
        sidechainId,
        withdrawalIndex,
        user.address,
        user.address,
        signatures,
      )
    }

    it('normally', async () => {
      await mint()
      await deposit()
      const tx = await finalizeWithdrawal()
      expect(await token.ownerOf(tokenId)).to.equal(user.address)
      await expect(tx)
        .to.emit(bridge, 'WithdrawalFinalized')
        .withArgs(depositIndex, sidechainId, withdrawalIndex, token.address, user.address, user.address)
    })

    it('invalid chain id', async () => {
      await mint()
      await deposit()
      const tx = finalizeWithdrawal(12345)
      await expect(tx).to.be.revertedWith('Invalid main chain id.')
    })

    it('already withdraw', async () => {
      await mint()
      await deposit()
      await finalizeWithdrawal()
      const tx = finalizeWithdrawal()
      await expect(tx).to.be.revertedWith('already withdraw')
    })

    it('failed token transfer', async () => {
      const to = '0xbeAfbeafbEAFBeAFbeAFBEafBEAFbeaFBEAfbeaF'

      await mint()
      await deposit()

      await token.forceTransfer(to, tokenId)
      expect(await token.ownerOf(tokenId)).to.equal(to)

      const tx = await finalizeWithdrawal()
      expect(await token.ownerOf(tokenId)).to.equal(to)
      await expect(tx)
        .to.emit(bridge, 'WithdrawalFailed')
        .withArgs(depositIndex, sidechainId, withdrawalIndex, token.address, user.address, user.address)
    })
  })

  describe('transferMainchainRelayer()', () => {
    const newRelayer = '0xbeAfbeafbEAFBeAFbeAFBEafBEAFbeaFBEAfbeaF'

    it('normally', async () => {
      expect(await bridge.owner()).to.equal(relayer.address)

      const hash = getTransferMainchainRelayerHash(mainchainId, newRelayer)
      const signatures = await makeSignature(signer, hash, mainchainId)
      await relayer.connect(user).transferMainchainRelayer(mainchainId, newRelayer, signatures)
      expect(await bridge.owner()).to.equal(newRelayer)
    })

    it('invalid chain id', async () => {
      const hash = getTransferMainchainRelayerHash(12345, newRelayer)
      const signatures = await makeSignature(signer, hash, mainchainId)
      const tx = relayer.connect(user).transferMainchainRelayer(12345, newRelayer, signatures)
      await expect(tx).to.be.revertedWith('Invalid main chain id.')
    })
  })
})