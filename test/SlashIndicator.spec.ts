import { ethers, network } from 'hardhat'
import { SignerWithAddress as Account } from '@nomiclabs/hardhat-ethers/signers'
import { toWei } from 'web3-utils'
import { expect } from 'chai'

import type { Environment, StakeManager, SlashIndicator } from '../typechain-types/contracts'
import type { PrecompileBLSVerify, PrecompileDoubleSign } from '../typechain-types/contracts/test'
import type { ISlashIndicator } from '../typechain-types/contracts/SlashIndicator'

import {
  EnvironmentValue,
  Validator,
  mining,
  PrecompileBLSVerifyAddress,
  PrecompileDoubleSignAddress,
  PrecompileBLSVerifyBytecode,
  PrecompileDoubleSignBytecode,
} from './helpers'

const initialEnv: EnvironmentValue = {
  startBlock: 0,
  startEpoch: 0,
  blockPeriod: 15,
  epochPeriod: 240,
  rewardRate: 10,
  commissionRate: 0,
  validatorThreshold: toWei('500'),
  jailThreshold: 50,
  jailPeriod: 2,
}

const gasPrice = 0
const chainId = 248
const blsPubKey = '0x9393c6ce7b837418a3409f464026569b5aeace7cfc05ccd9535a36d9de4613131b955dfc5c4d61f030922d3c17b211af'
const emptyBLSPubKey =
  '0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'

describe('SlashIndicator', () => {
  let accounts: Account[]
  let deployer: Account
  let owner: Account
  let operator: Account
  let attacker: Account
  let validator: Validator

  let stakeManager: StakeManager
  let environment: Environment
  let slashIndicator: SlashIndicator
  let precompileBLSVerify: PrecompileBLSVerify
  let precompileDoubleSign: PrecompileDoubleSign

  before(async () => {
    accounts = await ethers.getSigners()
    deployer = accounts[0]
    owner = accounts[accounts.length - 1]
    operator = accounts[accounts.length - 2]
    attacker = accounts[accounts.length - 3]
  })

  // setup the test network
  beforeEach(async () => {
    await network.provider.send('hardhat_reset')

    await network.provider.send('hardhat_setCode', [PrecompileBLSVerifyAddress, PrecompileBLSVerifyBytecode])
    precompileBLSVerify = (await ethers.getContractFactory('PrecompileBLSVerify')).attach(PrecompileBLSVerifyAddress)
    await network.provider.send('hardhat_setCode', [PrecompileDoubleSignAddress, PrecompileDoubleSignBytecode])
    precompileDoubleSign = (await ethers.getContractFactory('PrecompileDoubleSign')).attach(PrecompileDoubleSignAddress)

    // setup for the onlyCoinbase modifier
    await network.provider.send('hardhat_setCoinbase', [deployer.address])
  })

  // deploy the Environment contract
  beforeEach(async () => {
    const factory = await ethers.getContractFactory('Environment')
    environment = await factory.connect(deployer).deploy()
    await environment.initialize(initialEnv, { gasPrice })
  })

  // deploy the StakeManager contract
  beforeEach(async () => {
    const factory = await ethers.getContractFactory('StakeManager')
    stakeManager = await factory.connect(deployer).deploy()
  })

  // deploy the SlashIndicator contract
  beforeEach(async () => {
    const factory = await ethers.getContractFactory('SlashIndicator')
    slashIndicator = await factory.connect(deployer).deploy(environment.address, stakeManager.address, chainId)
  })

  // set the addresses of dependent contracts in the StakeManager
  beforeEach(async () => {
    const pad = (s: string, len = 32) => ethers.utils.hexZeroPad(s, len)
    const storages = [
      ['0x0', pad(environment.address, 31) + '01'], // combined value of the `bool public initialized`
      [ethers.utils.keccak256(pad(slashIndicator.address) + pad('0x' + Number(11).toString(16)).slice(2)), pad('0x1')],
    ]

    await Promise.all(
      storages.map(([slot, value]) =>
        network.provider.send('hardhat_setStorageAt', [stakeManager.address, slot, value]),
      ),
    )
  })

  beforeEach(async () => {
    validator = new Validator(stakeManager, owner, operator)
    await validator.joinValidator()
    await validator.updateBLSPublicKey(blsPubKey)
  })

  describe('submitDoubleSignEvidence', () => {
    const mockHeader1 = '0x1234'
    const mockHeader2 = '0xffff'

    it('success', async () => {
      await precompileDoubleSign.set(await operator.getAddress(), 123, false)

      const tx = await slashIndicator.submitDoubleSignEvidence(mockHeader1, mockHeader2)
      const epoch = (await environment.epoch()).toNumber()
      await expect(tx)
        .to.emit(stakeManager, 'ValidatorJailed')
        .withArgs(validator.owner.address, epoch + 3)
    })

    it('fail: invalid evidence', async () => {
      await precompileDoubleSign.set(await operator.getAddress(), 123, true)

      const tx = slashIndicator.submitDoubleSignEvidence(mockHeader1, mockHeader2)
      await expect(tx).to.revertedWithoutReason()
    })

    it('fail: validator not exist', async () => {
      await precompileDoubleSign.set(await attacker.getAddress(), 123, false)

      const tx = slashIndicator.submitDoubleSignEvidence(mockHeader1, mockHeader2)
      await expect(tx).to.revertedWith('ValidatorDoesNotExist()')
    })

    it('fail: evidence too old', async () => {
      const currentBlockNumber = await ethers.provider.getBlockNumber()
      await precompileDoubleSign.set(await operator.getAddress(), currentBlockNumber, false)
      await mining(currentBlockNumber + initialEnv.epochPeriod)

      const tx = slashIndicator.submitDoubleSignEvidence(mockHeader1, mockHeader2)
      await expect(tx).to.revertedWith('evidence too old')
    })
  })

  describe('submitFinalityViolationEvidence', () => {
    const sourceHash = `0x${'11'.repeat(32)}`
    let currentBlockNumber = 1
    let evidence: ISlashIndicator.FinalityEvidenceStruct

    beforeEach(async () => {
      currentBlockNumber = await ethers.provider.getBlockNumber()
      evidence = {
        voteA: {
          srcNum: currentBlockNumber - 1,
          srcHash: sourceHash,
          tarNum: currentBlockNumber,
          tarHash: `0x${'22'.repeat(32)}`,
          sig: `0x${'01'.repeat(96)}`,
        },
        voteB: {
          srcNum: currentBlockNumber - 1,
          srcHash: sourceHash,
          tarNum: currentBlockNumber,
          tarHash: `0x${'33'.repeat(32)}`,
          sig: `0x${'02'.repeat(96)}`,
        },
        voteAddr: blsPubKey,
      }
    })

    it('success', async () => {
      await precompileBLSVerify.set(true, false)

      const tx = await slashIndicator.submitFinalityViolationEvidence(evidence)
      const epoch = (await environment.epoch()).toNumber()
      await expect(tx)
        .to.emit(stakeManager, 'ValidatorJailed')
        .withArgs(validator.owner.address, epoch + 1)
    })

    it('fail: target block too old', async () => {
      await precompileBLSVerify.set(true, false)
      await mining(currentBlockNumber + initialEnv.epochPeriod)

      const tx = slashIndicator.submitFinalityViolationEvidence(evidence)
      await expect(tx).to.revertedWith('target block too old')
    })

    it('fail: two identical votes', async () => {
      await precompileBLSVerify.set(true, false)
      evidence.voteB.tarHash = evidence.voteA.tarHash

      const tx = slashIndicator.submitFinalityViolationEvidence(evidence)
      await expect(tx).to.revertedWith('two identical votes')
    })

    it('fail: invalid evidence', async () => {
      await precompileBLSVerify.set(true, true)

      const tx = slashIndicator.submitFinalityViolationEvidence(evidence)
      await expect(tx).to.revertedWithoutReason()
    })

    it('fail: verify signature failed', async () => {
      await precompileBLSVerify.set(false, false)

      const tx = slashIndicator.submitFinalityViolationEvidence(evidence)
      await expect(tx).to.revertedWith('verify signature failed')
    })

    it('fail: validator not exist', async () => {
      await precompileBLSVerify.set(true, false)
      evidence.voteAddr = emptyBLSPubKey

      const tx = slashIndicator.submitFinalityViolationEvidence(evidence)
      await expect(tx).to.revertedWith('ValidatorDoesNotExist()')
    })
  })
})
