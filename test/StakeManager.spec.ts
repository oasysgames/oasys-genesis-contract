import { ethers, network } from 'hardhat'
import { Contract, BigNumber } from 'ethers'
import { SignerWithAddress as Account } from '@nomiclabs/hardhat-ethers/signers'
import { toWei, fromWei } from 'web3-utils'
import { expect } from 'chai'

import type { Environment, StakeManager, CandidateValidatorManager } from '../typechain-types/contracts'
import type { Allowlist } from '../typechain-types/contracts/lib'
import type { TestERC20 } from '../typechain-types/contracts/test'

import {
  EnvironmentValue,
  Validator,
  Staker,
  mining,
  zeroAddress,
  Token,
  WOASAddress,
  SOASAddress,
  TestERC20Bytecode,
  toBNWei,
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

describe('StakeManager', () => {
  let accounts: Account[]
  let stakeManager: StakeManager
  let environment: Environment
  let allowlist: Allowlist
  let candidateManager: CandidateValidatorManager
  let woas: TestERC20
  let soas: TestERC20

  let deployer: Account

  let validator1: Validator
  let validator2: Validator
  let validator3: Validator
  let validator4: Validator
  let fixedValidator: Validator
  let validators: Validator[]

  let staker1: Staker
  let staker2: Staker
  let staker3: Staker
  let staker4: Staker
  let staker5: Staker
  let staker6: Staker
  let stakers: Staker[]

  let currentBlock = 0

  const expectCurrentValidators = async (
    expValidators: Validator[],
    expCandidates: boolean[],
    expStakes?: string[],
    expBLSPublicKeys?: string[]
  ) => {
    await expectValidators(await getEpoch(0), expValidators, expCandidates, expStakes, expBLSPublicKeys)
  }

  const expectNextValidators = async (expValidators: Validator[], expCandidates: boolean[], expStakes?: string[], expBLSPublicKeys?: string[]) => {
    await expectValidators(await getEpoch(1), expValidators, expCandidates, expStakes, expBLSPublicKeys)
  }

  const expectValidators = async (
    epoch: number,
    expValidators: Validator[],
    expCandidates: boolean[],
    expStakes?: string[],
    expBLSPublicKeys?: string[],
    cursor = 0,
    howMany = 100,
    expNewCursor?: number,
  ) => {
    const res = await stakeManager.getValidators(epoch, cursor, howMany)
    _expectValidators({
      ...res,
      expValidators,
      expCandidates,
      expStakes,
      expBLSPublicKeys,
      expNewCursor,
    })
  }

  const expectCurrentCandidateValidators = async (
    expValidators: Validator[],
    expCandidates: boolean[],
    expStakes?: string[],
    cursor = 0,
    howMany = 100,
    expNewCursor?: number,
  ) => {
    const res = await candidateManager.getHighStakes(await getEpoch(), cursor, howMany)
    _expectValidators({
      ...res,
      expValidators,
      expCandidates,
      expStakes,
      expNewCursor,
    })
  }

  const expectNextCandidateValidators = async (
    expValidators: Validator[],
    expCandidates: boolean[],
    expStakes?: string[],
    expBLSPublicKeys?: string[],
    cursor = 0,
    howMany = 100,
    expNewCursor?: number,
  ) => {
    const res = await candidateManager.getHighStakes(await getEpoch(1), cursor, howMany)
    _expectValidators({
      ...res,
      expValidators,
      expCandidates,
      expStakes,
      expBLSPublicKeys,
      expNewCursor,
    })
  }

  const _expectValidators = (params: {
    owners: string[]
    operators: string[]
    stakes: BigNumber[]
    blsPublicKeys: string[]
    candidates: boolean[]
    newCursor: BigNumber
    expValidators: Validator[]
    expCandidates: boolean[]
    expStakes?: string[]
    expBLSPublicKeys?: string[]
    expNewCursor?: number
  }) => {
    expect(params.owners).to.eql(params.expValidators.map((x) => x.owner.address))
    expect(params.operators).to.eql(params.expValidators.map((x) => x.operator.address))
    expect(params.candidates).to.eql(params.expCandidates)
    if (params.expStakes) {
      expect(params.stakes.map((x: any) => fromWei(x.toString()))).to.eql(params.expStakes)
    }
    expect(params.newCursor).to.equal(params.expNewCursor ?? params.owners.length)
    if (params.expBLSPublicKeys) {
      expect(params.blsPublicKeys).to.eql(params.expBLSPublicKeys)
    }
  }

  const expectBalance = async (
    holder: Contract | Account,
    expectOAS: string,
    expectWOAS: string,
    expectSOAS: string,
  ) => {
    const actualOAS = fromWei((await stakeManager.provider.getBalance(holder.address)).toString())
    const actualWOAS = fromWei((await woas.balanceOf(holder.address)).toString())
    const actualSOAS = fromWei((await soas.balanceOf(holder.address)).toString())
    expect(actualOAS).to.match(new RegExp(`^${expectOAS}`))
    expect(actualWOAS).to.match(new RegExp(`^${expectWOAS}`))
    expect(actualSOAS).to.match(new RegExp(`^${expectSOAS}`))
  }

  const initializeValidators = async () => {
    await Promise.all(validators.map((x) => x.joinValidator()))
    await fixedValidator.stake(Token.OAS, fixedValidator, '500')
  }

  const initialize = async () => {
    await initializeValidators()
  }

  const toNextEpoch = async () => {
    currentBlock += initialEnv.epochPeriod
    await mining(currentBlock)
  }

  const getEpoch = async (incr?: number): Promise<number> => {
    return (await environment.epoch()).toNumber() + (incr ?? 0)
  }

  const setCoinbase = async (address: string) => {
    const current = await network.provider.send('eth_coinbase')
    await network.provider.send('hardhat_setCoinbase', [address])
    return async () => await network.provider.send('hardhat_setCoinbase', [current])
  }

  const updateEnvironment = async (diff: object) => {
    const restoreCoinbase = await setCoinbase(fixedValidator.operator.address)
    await environment
      .connect(fixedValidator.operator)
      .updateValue({ ...(await environment.value()), ...diff }, { gasPrice })
    await restoreCoinbase()
  }

  const slash = async (validator: Validator, target: Validator, count: number) => {
    const env = await environment.value()
    const { operators, candidates } = await stakeManager.getValidators(await getEpoch(0), 0, 100)
    const blocks = ~~(env.epochPeriod.toNumber() / operators.filter((_: any, i: number) => candidates[i]).length)

    const restoreCoinbase = await setCoinbase(validator.operator.address)
    await Promise.all([...Array(count).keys()].map((_) => validator.slash(target, blocks)))
    await restoreCoinbase()
  }

  before(async () => {
    accounts = await ethers.getSigners()
    deployer = accounts[0]
  })

  // setup the test network
  beforeEach(async () => {
    currentBlock = 0

    await network.provider.send('hardhat_reset')
    await network.provider.send('hardhat_setCode', [WOASAddress, TestERC20Bytecode])
    await network.provider.send('hardhat_setCode', [SOASAddress, TestERC20Bytecode])

    // setup for the onlyCoinbase modifier
    await network.provider.send('hardhat_setCoinbase', [deployer.address])
  })

  // deploy the Environment contract
  beforeEach(async () => {
    const factory = await ethers.getContractFactory('Environment')
    environment = await factory.connect(deployer).deploy()
    await environment.initialize(initialEnv, { gasPrice })
  })

  // deploy the Allowlist contract
  beforeEach(async () => {
    const factory = await ethers.getContractFactory('Allowlist')
    allowlist = await factory.connect(deployer).deploy()
  })

  // deploy the StakeManager contract
  beforeEach(async () => {
    const factory = await ethers.getContractFactory('StakeManager')
    stakeManager = await factory.connect(deployer).deploy()
  })

  // deploy the CandidateValidatorManager contract
  beforeEach(async () => {
    const addrListFactory = await ethers.getContractFactory('AddressList')
    const candidateManagerFactory = await ethers.getContractFactory('CandidateValidatorManager')

    const addrList = await addrListFactory.connect(deployer).deploy()
    candidateManager = await candidateManagerFactory
      .connect(deployer)
      .deploy(environment.address, stakeManager.address, addrList.address)

    await addrList.transferOwnership(candidateManager.address)
  })

  // set the addresses of dependent contracts in the StakeManager
  beforeEach(async () => {
    const pad = (s: string, len = 32) => ethers.utils.hexZeroPad(s, len)

    const storages = [
      ['0x0', pad(environment.address, 31) + '01'], // combined value of the `bool public initialized`
      ['0x1', pad(allowlist.address)],
      ['0x9', pad(candidateManager.address)],
    ]

    await Promise.all(
      storages.map(([slot, value]) =>
        network.provider.send('hardhat_setStorageAt', [stakeManager.address, slot, value]),
      ),
    )

    expect(await stakeManager.initialized()).to.be.true
    expect(await stakeManager.environment()).to.equal(environment.address)
    expect(await stakeManager.allowlist()).to.equal(allowlist.address)
    expect(await stakeManager.candidateManager()).to.equal(candidateManager.address)
  })

  // setup validators and delegates
  beforeEach(async () => {
    validator1 = new Validator(stakeManager, accounts[1], accounts[2])
    validator2 = new Validator(stakeManager, accounts[3], accounts[4])
    validator3 = new Validator(stakeManager, accounts[5], accounts[6])
    validator4 = new Validator(stakeManager, accounts[7], accounts[8])
    fixedValidator = new Validator(stakeManager, accounts[9], accounts[10])
    validators = [validator1, validator2, validator3, validator4, fixedValidator]

    staker1 = new Staker(stakeManager, accounts[11])
    staker2 = new Staker(stakeManager, accounts[12])
    staker3 = new Staker(stakeManager, accounts[13])
    staker4 = new Staker(stakeManager, accounts[14])
    staker5 = new Staker(stakeManager, accounts[15])
    staker6 = new Staker(stakeManager, accounts[16])
    stakers = [staker1, staker2, staker3, staker4, staker5, staker6]
  })

  // mint WOAS and SOAS to delegates
  beforeEach(async () => {
    woas = (await ethers.getContractFactory('TestERC20')).attach(WOASAddress)
    soas = (await ethers.getContractFactory('TestERC20')).attach(SOASAddress)
    await Promise.all(
      stakers.map(
        (x) =>
          new Promise(async (resolve) => {
            const value = toWei('1000')
            await woas.connect(x.signer).mint({ gasPrice, value })
            await woas.connect(x.signer).approve(stakeManager.address, value, { gasPrice })
            await soas.connect(x.signer).mint({ gasPrice, value })
            await soas.connect(x.signer).approve(stakeManager.address, value, { gasPrice })
            resolve(true)
          }),
      ),
    )
  })

  it('addRewardBalance()', async () => {
    const check = async (exp: string) => {
      const actual = await stakeManager.provider.getBalance(stakeManager.address)
      expect(fromWei(actual.toString())).to.equal(exp)
    }

    await check('0')

    const tx = await stakeManager.addRewardBalance({ value: toWei('1') })
    await check('1')

    await expect(tx).to.emit(stakeManager, 'AddedRewardBalance').withArgs(toWei('1'))
  })

  describe('validator owner or operator functions', () => {
    let validator: Validator
    let owner: Account
    let operator: Account
    let attacker: Account

    before(() => {
      owner = accounts[accounts.length - 1]
      operator = accounts[accounts.length - 2]
      attacker = accounts[accounts.length - 3]
    })

    beforeEach(async () => {
      validator = new Validator(stakeManager, owner, operator)
    })

    describe('joinValidator()', () => {
      let attackerv: Validator

      beforeEach(async () => {
        attackerv = new Validator(stakeManager, attacker, operator)

        await expect(await validator.joinValidator())
          .to.emit(stakeManager, 'ValidatorJoined')
          .withArgs(validator.owner.address)
      })

      it('should revert when already joined', async () => {
        const tx = validator.joinValidator('0x0000000000000000000000000000000000000001')
        await expect(tx).to.revertedWith('AlreadyJoined()')
      })

      it('should revert when operator address is zero', async () => {
        const tx = attackerv.joinValidator(zeroAddress)
        await expect(tx).to.revertedWith('EmptyAddress()')
      })

      it('should revert when operator address asme as owner address', async () => {
        const tx = attackerv.joinValidator(attacker.address)
        await expect(tx).to.revertedWith('SameAsOwner()')
      })

      it('should revert when operator address is already in use', async () => {
        const tx = attackerv.joinValidator(operator.address)
        await expect(tx).to.revertedWith('AlreadyInUse()')
      })
    })

    it('updateOperator()', async () => {
      const newOperator = accounts[accounts.length - 3]

      await validator.joinValidator()

      let tx = validator.updateOperator(zeroAddress)
      await expect(tx).to.revertedWith('EmptyAddress()')

      tx = validator.updateOperator(owner.address)
      await expect(tx).to.revertedWith('SameAsOwner()')

      // from owner
      await expect(await validator.updateOperator(newOperator.address))
        .to.emit(stakeManager, 'OperatorUpdated')
        .withArgs(validator.owner.address, validator.operator.address, newOperator.address)
      expect((await validator.getInfo()).operator).to.equal(newOperator.address)

      // from operator
      tx = validator.updateOperator(operator.address, operator)
      await expect(tx).to.revertedWith('ValidatorDoesNotExist()')

      // from attacker
      tx = validator.updateOperator(attacker.address, attacker)
      await expect(tx).to.revertedWith('ValidatorDoesNotExist()')
    })

    it('updateBLSPublicKey()', async () => {
      const ethPrivKey = '0xd1c71e71b06e248c8dbe94d49ef6d6b0d64f5d71b1e33a0f39e14dadb070304a'
      const emptyBLSPubKey = '0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
      const blsPubKey = "0x9393c6ce7b837418a3409f464026569b5aeace7cfc05ccd9535a36d9de4613131b955dfc5c4d61f030922d3c17b211af"

      const newBLSPubKey = "0x16e08cfa832b113a1c9042b3579fc9000973417fb2295568396ffe74e6445457278382ab121d513f4a0ecf22144d2c93"

      await validator.joinValidator()

      // invalid length
      let tx = validator.updateBLSPublicKey(ethPrivKey)
      await expect(tx).to.revertedWith('InvalidBLSLength()')

      // empty
      tx = validator.updateBLSPublicKey(emptyBLSPubKey)
      await expect(tx).to.revertedWith('EmptyBLS()')

      // register at first time
      await expect(await validator.updateBLSPublicKey(blsPubKey))
        .to.emit(stakeManager, 'BLSPublicKeyUpdated')
        .withArgs(validator.owner.address, "0x", blsPubKey)
      expect((await validator.getInfo()).blsPublicKey).to.equal(blsPubKey)

      // fail: from operator
      tx = validator.updateBLSPublicKey(newBLSPubKey, operator)
      await expect(tx).to.revertedWith('ValidatorDoesNotExist()')

      // fail: from attacker
      tx = validator.updateBLSPublicKey(newBLSPubKey, attacker)
      await expect(tx).to.revertedWith('ValidatorDoesNotExist()')

      // fail: already registered BLS public key
      const validator2 = new Validator(stakeManager, accounts[1], accounts[2])
      await validator2.joinValidator()
      tx = validator2.updateBLSPublicKey(blsPubKey)
      await expect(tx).to.revertedWith('AlreadyInUse()')

      // update
      await expect(await validator.updateBLSPublicKey(newBLSPubKey))
        .to.emit(stakeManager, 'BLSPublicKeyUpdated')
        .withArgs(validator.owner.address, blsPubKey, newBLSPubKey)
      expect((await validator.getInfo()).blsPublicKey).to.equal(newBLSPubKey)
    })

    it('deactivateValidator() and activateValidator()', async () => {
      await validator.joinValidator()
      await staker1.stake(Token.OAS, validator, '500')

      await expectValidators(await getEpoch(0), [validator], [false], ['0'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [true], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.true

      await toNextEpoch()

      await expectValidators(await getEpoch(0), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [true], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.true

      // from owner
      await validator.deactivateValidator([await getEpoch(1)], owner)

      await expectValidators(await getEpoch(0), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [false], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.true

      await toNextEpoch()

      await expectValidators(await getEpoch(0), [validator], [false], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [true], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.false

      await toNextEpoch()

      await expectValidators(await getEpoch(0), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [true], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.true

      await validator.deactivateValidator([await getEpoch(2), await getEpoch(3), await getEpoch(5)], owner)
      await expectValidators(await getEpoch(0), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(2), [validator], [false], ['500'], ['0x'])
      await expectValidators(await getEpoch(3), [validator], [false], ['500'], ['0x'])
      await expectValidators(await getEpoch(4), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(5), [validator], [false], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.true

      await validator.activateValidator([await getEpoch(3)])
      await expectValidators(await getEpoch(0), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(2), [validator], [false], ['500'], ['0x'])
      await expectValidators(await getEpoch(3), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(4), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(5), [validator], [false], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.true

      await toNextEpoch()

      await expectValidators(await getEpoch(0), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [false], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.true

      await toNextEpoch()

      await expectValidators(await getEpoch(0), [validator], [false], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [true], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.false

      await toNextEpoch()

      await expectValidators(await getEpoch(0), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [true], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.true

      await toNextEpoch()

      await expectValidators(await getEpoch(0), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [false], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.true

      await toNextEpoch()

      await expectValidators(await getEpoch(0), [validator], [false], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [true], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.false

      await toNextEpoch()

      // from operator
      await validator.deactivateValidator([await getEpoch(1)], operator)

      await expectValidators(await getEpoch(0), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [false], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.true

      await toNextEpoch()

      await expectValidators(await getEpoch(0), [validator], [false], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [true], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.false

      await toNextEpoch()

      await expectValidators(await getEpoch(0), [validator], [true], ['500'], ['0x'])
      await expectValidators(await getEpoch(1), [validator], [true], ['500'], ['0x'])
      expect((await validator.getInfo()).active).to.be.true

      // from attacker
      let tx = validator.deactivateValidator([await getEpoch(1)], attacker)
      await expect(tx).to.revertedWith('UnauthorizedSender()')

      tx = validator.activateValidator([await getEpoch(1)], attacker)
      await expect(tx).to.revertedWith('UnauthorizedSender()')
    })

    it('claimCommissions()', async () => {
      await validator.joinValidator()
      await updateEnvironment({ startEpoch: await getEpoch(1), commissionRate: 50 })

      await staker1.stake(Token.OAS, validator, '500')
      await staker1.stake(Token.wOAS, validator, '250')
      await staker1.stake(Token.sOAS, validator, '250')

      await expectBalance(stakeManager, '500', '250', '250')
      await expectBalance(validator.owner, '10000', '0', '0')

      await toNextEpoch()
      await toNextEpoch()

      await expect(await validator.claimCommissions(owner))
        .to.emit(stakeManager, 'ClaimedCommissions')
        .withArgs(validator.owner.address, toBNWei('0.005707762557077625'))
      await expectBalance(stakeManager, '499.994292237442922375', '250', '250')
      await expectBalance(validator.owner, '10000.005707762557077625', '0', '0')

      await toNextEpoch()
      await toNextEpoch()
    })

    it('restakeCommissions()', async () => {
      await validator.joinValidator()
      await updateEnvironment({ startEpoch: await getEpoch(1), commissionRate: 10 })
      await toNextEpoch()

      await woas.connect(validator.owner).mint({ gasPrice, value: toWei('1000') })
      await woas.connect(validator.owner).approve(stakeManager.address, toWei('1000'), { gasPrice })

      await expectBalance(stakeManager, '0', '0', '0')
      await expectBalance(validator.owner, '9000', '1000', '0')
      await validator.expectTotalStake('0', '0', '0')

      await validator.stake(Token.wOAS, validator, '1000')
      await toNextEpoch()

      await expectBalance(stakeManager, '0', '1000', '0')
      await expectBalance(validator.owner, '9000', '0', '0')
      await validator.expectTotalStake('0', '1000', '0')

      await expect(validator.restakeCommissions()).to.revertedWith('NoAmount')

      await toNextEpoch()

      const tx = await validator.restakeCommissions()
      await expect(tx)
        .to.emit(stakeManager, 'ReStaked')
        .withArgs(validator.owner.address, validator.owner.address, '1141552511415525')

      await expectBalance(stakeManager, '0', '1000', '0')
      await expectBalance(validator.owner, '9000', '0', '0')
      await validator.expectTotalStake('0.00114155', '1000', '0')

      await toNextEpoch()
      await toNextEpoch()
      await toNextEpoch()
      await validator.restakeCommissions()

      await expectBalance(stakeManager, '0', '1000', '0')
      await expectBalance(validator.owner, '9000', '0', '0')
      await validator.expectTotalStake('0.0045662', '1000', '0')
    })
  })

  describe('staker functions', () => {
    beforeEach(async () => {
      await initialize()
    })

    it('stake()', async () => {
      await expectBalance(stakeManager, '500', '0', '0')
      await expectBalance(staker1.signer, '8000', '1000', '1000')
      await staker1.expectTotalStake('0', '0', '0')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      await staker1.stake(Token.OAS, validator1, '5')
      await staker1.stake(Token.wOAS, validator1, '2.5')
      await staker1.stake(Token.sOAS, validator1, '2.5')

      await expectBalance(stakeManager, '505', '2.5', '2.5')
      await expectBalance(staker1.signer, '7995', '997.5', '997.5')
      await staker1.expectTotalStake('0', '0', '0')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      await toNextEpoch()

      await expectBalance(stakeManager, '505', '2.5', '2.5')
      await expectBalance(staker1.signer, '7995', '997.5', '997.5')
      await staker1.expectTotalStake('5', '2.5', '2.5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['5', '0', '0', '0', '0'],
          ['2.5', '0', '0', '0', '0'],
          ['2.5', '0', '0', '0', '0'],
        ],
      )

      await staker1.stake(Token.OAS, validator1, '20')
      await staker1.stake(Token.OAS, validator1, '10')
      await staker1.stake(Token.wOAS, validator1, '10')
      await staker1.stake(Token.sOAS, validator1, '10')

      await expectBalance(stakeManager, '535', '12.5', '12.5')
      await expectBalance(staker1.signer, '7965', '987.5', '987.5')
      await staker1.expectTotalStake('5', '2.5', '2.5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['5', '0', '0', '0', '0'],
          ['2.5', '0', '0', '0', '0'],
          ['2.5', '0', '0', '0', '0'],
        ],
      )

      await toNextEpoch()

      await expectBalance(stakeManager, '535', '12.5', '12.5')
      await expectBalance(staker1.signer, '7965', '987.5', '987.5')
      await staker1.expectTotalStake('35', '12.5', '12.5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['35', '0', '0', '0', '0'],
          ['12.5', '0', '0', '0', '0'],
          ['12.5', '0', '0', '0', '0'],
        ],
      )

      await staker1.stake(Token.OAS, validator1, '20')
      await staker1.stake(Token.wOAS, validator1, '10')
      await staker1.stake(Token.sOAS, validator1, '10')
      await staker1.stake(Token.OAS, validator2, '20')
      await staker1.stake(Token.wOAS, validator2, '10')
      await staker1.stake(Token.sOAS, validator2, '10')

      await toNextEpoch()

      await expectBalance(stakeManager, '575', '32.5', '32.5')
      await expectBalance(staker1.signer, '7925', '967.5', '967.5')
      await staker1.expectTotalStake('75', '32.5', '32.5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['55', '20', '0', '0', '0'],
          ['22.5', '10', '0', '0', '0'],
          ['22.5', '10', '0', '0', '0'],
        ],
      )
    })

    xit('[OBSOLETED] unstake() and claimUnstakes()', async () => {
      await expectBalance(stakeManager, '500', '0', '0')
      await expectBalance(staker1.signer, '8000', '1000', '1000')
      await staker1.expectTotalStake('0', '0', '0')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      await staker1.stake(Token.OAS, validator1, '5')
      await staker1.stake(Token.wOAS, validator1, '5')
      await staker1.stake(Token.OAS, validator2, '10')
      await staker1.stake(Token.sOAS, validator2, '10')

      await toNextEpoch()

      await expectBalance(stakeManager, '515', '5', '10')
      await expectBalance(staker1.signer, '7985', '995', '990')
      await staker1.expectTotalStake('15', '5', '10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['5', '10', '0', '0', '0'],
          ['5', '0', '0', '0', '0'],
          ['0', '10', '0', '0', '0'],
        ],
      )

      await staker1.unstake(Token.OAS, validator1, '2.5')
      await staker1.unstake(Token.wOAS, validator1, '2.5')
      await staker1.unstake(Token.sOAS, validator1, '2.5')

      await expectBalance(stakeManager, '515', '5', '10')
      await expectBalance(staker1.signer, '7985', '995', '990')
      await staker1.expectTotalStake('15', '5', '10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['5', '10', '0', '0', '0'],
          ['5', '0', '0', '0', '0'],
          ['0', '10', '0', '0', '0'],
        ],
      )

      await toNextEpoch()

      await expectBalance(stakeManager, '515', '5', '10')
      await expectBalance(staker1.signer, '7985', '995', '990')
      await staker1.expectTotalStake('12.5', '2.5', '10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['2.5', '10', '0', '0', '0'],
          ['2.5', '0', '0', '0', '0'],
          ['0', '10', '0', '0', '0'],
        ],
      )

      await staker1.unstake(Token.OAS, validator1, '1')
      await staker1.unstake(Token.OAS, validator1, '1')
      await staker1.unstake(Token.wOAS, validator1, '1')
      await staker1.unstake(Token.wOAS, validator1, '1')

      await expectBalance(stakeManager, '515', '5', '10')
      await expectBalance(staker1.signer, '7985', '995', '990')
      await staker1.expectTotalStake('12.5', '2.5', '10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['2.5', '10', '0', '0', '0'],
          ['2.5', '0', '0', '0', '0'],
          ['0', '10', '0', '0', '0'],
        ],
      )

      await toNextEpoch()

      await expectBalance(stakeManager, '515', '5', '10')
      await expectBalance(staker1.signer, '7985', '995', '990')
      await staker1.expectTotalStake('10.5', '0.5', '10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0.5', '10', '0', '0', '0'],
          ['0.5', '0', '0', '0', '0'],
          ['0', '10', '0', '0', '0'],
        ],
      )

      await staker1.unstake(Token.OAS, validator1, '9999')
      await staker1.unstake(Token.wOAS, validator1, '9999')
      await staker1.unstake(Token.OAS, validator2, '5')
      await staker1.unstake(Token.sOAS, validator2, '5')

      await toNextEpoch()

      await expectBalance(stakeManager, '515', '5', '10')
      await expectBalance(staker1.signer, '7985', '995', '990')
      await staker1.expectTotalStake('5', '0', '5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '5', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '5', '0', '0', '0'],
        ],
      )

      await staker1.claimUnstakes()

      await expectBalance(stakeManager, '505', '0', '5')
      await expectBalance(staker1.signer, '7995', '1000', '995')
      await staker1.expectTotalStake('5', '0', '5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '5', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '5', '0', '0', '0'],
        ],
      )

      // testing for immediate refunds
      await staker1.stake(Token.OAS, validator2, '5')
      await staker1.stake(Token.wOAS, validator2, '10')
      await staker1.stake(Token.sOAS, validator2, '15')

      await expectBalance(stakeManager, '510', '10', '20')
      await expectBalance(staker1.signer, '7990', '990', '980')
      await staker1.expectTotalStake('5', '0', '5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '5', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '5', '0', '0', '0'],
        ],
      )

      await staker1.unstake(Token.OAS, validator2, '10')
      await staker1.unstake(Token.wOAS, validator2, '15')
      await staker1.unstake(Token.sOAS, validator2, '20')

      await expectBalance(stakeManager, '505', '0', '5')
      await expectBalance(staker1.signer, '7995', '1000', '995')
      await staker1.expectTotalStake('5', '0', '5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '5', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '5', '0', '0', '0'],
        ],
      )

      // cannot be claim until the next epoch
      await staker1.claimUnstakes()

      await expectBalance(stakeManager, '505', '0', '5')
      await expectBalance(staker1.signer, '7995', '1000', '995')
      await staker1.expectTotalStake('5', '0', '5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '5', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '5', '0', '0', '0'],
        ],
      )

      await toNextEpoch()
      await staker1.claimUnstakes()

      await expectBalance(stakeManager, '500', '0', '0')
      await expectBalance(staker1.signer, '8000', '1000', '1000')
      await staker1.expectTotalStake('0', '0', '0')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      // check for double claim
      await staker1.claimUnstakes()
      await toNextEpoch()
      await staker1.claimUnstakes()

      await expectBalance(stakeManager, '500', '0', '0')
      await expectBalance(staker1.signer, '8000', '1000', '1000')
      await staker1.expectTotalStake('0', '0', '0')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      await staker1.stake(Token.OAS, validator2, '10')
      await staker1.stake(Token.wOAS, validator2, '15')
      await staker1.stake(Token.sOAS, validator2, '20')

      await expectBalance(stakeManager, '510', '15', '20')
      await expectBalance(staker1.signer, '7990', '985', '980')
      await staker1.expectTotalStake('0', '0', '0')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      await staker1.unstake(Token.OAS, validator2, '5')
      await staker1.unstake(Token.wOAS, validator2, '10')
      await staker1.unstake(Token.sOAS, validator2, '15')

      await expectBalance(stakeManager, '505', '5', '5')
      await expectBalance(staker1.signer, '7995', '995', '995')
      await staker1.expectTotalStake('0', '0', '0')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      await toNextEpoch()

      await expectBalance(stakeManager, '505', '5', '5')
      await expectBalance(staker1.signer, '7995', '995', '995')
      await staker1.expectTotalStake('5', '5', '5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '5', '0', '0', '0'],
          ['0', '5', '0', '0', '0'],
          ['0', '5', '0', '0', '0'],
        ],
      )

      await staker1.unstake(Token.OAS, validator2, '5')

      await expectBalance(stakeManager, '505', '5', '5')
      await expectBalance(staker1.signer, '7995', '995', '995')
      await expectBalance(staker2.signer, '8000', '1000', '1000')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '5', '0', '0', '0'],
          ['0', '5', '0', '0', '0'],
          ['0', '5', '0', '0', '0'],
        ],
      )
      await staker2.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      // claim from outsider
      await toNextEpoch()
      await staker1.claimUnstakes(staker2.signer)

      await expectBalance(stakeManager, '500', '5', '5')
      await expectBalance(staker1.signer, '8000', '995', '995')
      await expectBalance(staker2.signer, '8000', '1000', '1000')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '5', '0', '0', '0'],
          ['0', '5', '0', '0', '0'],
        ],
      )
      await staker2.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )
    })

    it('unstakeV2() and claimLockedUnstake()', async () => {
      await expectBalance(stakeManager, '500', '0', '0')
      await expectBalance(staker1.signer, '8000', '1000', '1000')
      await staker1.expectTotalStake('0', '0', '0')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      await staker1.stake(Token.OAS, validator1, '5')
      await staker1.stake(Token.wOAS, validator1, '5')
      await staker1.stake(Token.OAS, validator2, '10')
      await staker1.stake(Token.sOAS, validator2, '10')

      await toNextEpoch()

      await expectBalance(stakeManager, '515', '5', '10')
      await expectBalance(staker1.signer, '7985', '995', '990')
      await staker1.expectTotalStake('15', '5', '10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['5', '10', '0', '0', '0'],
          ['5', '0', '0', '0', '0'],
          ['0', '10', '0', '0', '0'],
        ],
      )

      const tx1 = await staker1.unstakeV2(Token.OAS, validator1, '2.5')
      const tx2 = await staker1.unstakeV2(Token.wOAS, validator1, '2.5')
      await expect(tx1).to.emit(stakeManager, 'UnstakedV2').withArgs(staker1.address, validator1.owner.address, 0)
      await expect(tx2).to.emit(stakeManager, 'UnstakedV2').withArgs(staker1.address, validator1.owner.address, 1)

      await expectBalance(stakeManager, '515', '5', '10')
      await expectBalance(staker1.signer, '7985', '995', '990')
      await staker1.expectTotalStake('15', '5', '10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['5', '10', '0', '0', '0'],
          ['5', '0', '0', '0', '0'],
          ['0', '10', '0', '0', '0'],
        ],
      )

      await toNextEpoch()

      await expectBalance(stakeManager, '515', '5', '10')
      await expectBalance(staker1.signer, '7985', '995', '990')
      await staker1.expectTotalStake('12.5', '2.5', '10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['2.5', '10', '0', '0', '0'],
          ['2.5', '0', '0', '0', '0'],
          ['0', '10', '0', '0', '0'],
        ],
      )

      await staker1.unstakeV2(Token.OAS, validator1, '1')
      await staker1.unstakeV2(Token.OAS, validator1, '1')
      await staker1.unstakeV2(Token.wOAS, validator1, '1')
      await staker1.unstakeV2(Token.wOAS, validator1, '1')

      expect(await staker1.getLockedUnstakeCount()).to.equal(6)

      await expectBalance(stakeManager, '515', '5', '10')
      await expectBalance(staker1.signer, '7985', '995', '990')
      await staker1.expectTotalStake('12.5', '2.5', '10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['2.5', '10', '0', '0', '0'],
          ['2.5', '0', '0', '0', '0'],
          ['0', '10', '0', '0', '0'],
        ],
      )

      await toNextEpoch()

      await expectBalance(stakeManager, '515', '5', '10')
      await expectBalance(staker1.signer, '7985', '995', '990')
      await staker1.expectTotalStake('10.5', '0.5', '10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0.5', '10', '0', '0', '0'],
          ['0.5', '0', '0', '0', '0'],
          ['0', '10', '0', '0', '0'],
        ],
      )

      await staker1.unstakeV2(Token.OAS, validator1, '9999')
      await staker1.unstakeV2(Token.wOAS, validator1, '9999')
      await staker1.unstakeV2(Token.OAS, validator2, '5')
      await staker1.unstakeV2(Token.sOAS, validator2, '5')
      await expect(staker1.unstakeV2(Token.wOAS, validator1, '1')).to.revertedWith('NoAmount')

      expect(await staker1.getLockedUnstakeCount()).to.equal(10)

      await toNextEpoch()

      await expectBalance(stakeManager, '515', '5', '10')
      await expectBalance(staker1.signer, '7985', '995', '990')
      await staker1.expectTotalStake('5', '0', '5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '5', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '5', '0', '0', '0'],
        ],
      )

      const block = await ethers.provider.getBlock('latest')
      const length = (await staker1.getLockedUnstakeCount()).toNumber()

      await network.provider.send('evm_setNextBlockTimestamp', [block.timestamp + 863000])
      await network.provider.send('evm_mine')

      await expect(staker1.claimLockedUnstake(length - 1)).to.revertedWith('Locked')

      await network.provider.send('evm_setNextBlockTimestamp', [block.timestamp + 864000])
      await network.provider.send('evm_mine')

      const stakeManagerBalances: { [t: number]: BigNumber } = {
        0: toBNWei('515'),
        1: toBNWei('5'),
        2: toBNWei('10'),
      }
      const stakerBalances: { [t: number]: BigNumber } = {
        0: toBNWei('7985'),
        1: toBNWei('995'),
        2: toBNWei('990'),
      }

      for (let i = 0; i < length; i++) {
        const tx = await staker1.claimLockedUnstake(i)
        await expect(tx).to.emit(stakeManager, 'ClaimedLockedUnstake').withArgs(staker1.address, i)

        const req = await staker1.getLockedUnstake(i)
        expect(req.amount).to.gt(0)

        stakeManagerBalances[req.token] = stakeManagerBalances[req.token].sub(req.amount)
        stakerBalances[req.token] = stakerBalances[req.token].add(req.amount)

        await expectBalance(
          stakeManager,
          fromWei(stakeManagerBalances[0].toString()),
          fromWei(stakeManagerBalances[1].toString()),
          fromWei(stakeManagerBalances[2].toString()),
        )
        await expectBalance(
          staker1.signer,
          fromWei(stakerBalances[0].toString()),
          fromWei(stakerBalances[1].toString()),
          fromWei(stakerBalances[2].toString()),
        )
        await staker1.expectTotalStake('5', '0', '5')
        await staker1.expectStakes(
          0,
          [validator1, validator2, validator3, validator4, fixedValidator],
          [
            ['0', '5', '0', '0', '0'],
            ['0', '0', '0', '0', '0'],
            ['0', '5', '0', '0', '0'],
          ],
        )
      }

      // check for double claim
      for (let i = 0; i < length; i++) {
        await expect(staker1.claimLockedUnstake(i)).to.revertedWith('AlreadyClaimed')
      }
    })

    it('restakeRewards()', async () => {
      await expectBalance(stakeManager, '500', '0', '0')
      await expectBalance(staker1.signer, '8000', '1000', '1000')
      await staker1.expectTotalStake('0', '0', '0')

      await staker1.stake(Token.wOAS, validator1, '1000')
      await toNextEpoch()

      await expectBalance(stakeManager, '500', '1000', '0')
      await expectBalance(staker1.signer, '8000', '0', '1000')
      await staker1.expectTotalStake('0', '1000', '0')

      await expect(staker1.restakeRewards(validator1)).to.revertedWith('NoAmount')

      await toNextEpoch()

      const tx = await staker1.restakeRewards(validator1)
      await expect(tx)
        .to.emit(stakeManager, 'ReStaked')
        .withArgs(staker1.address, validator1.owner.address, '11415525114155251')

      await expectBalance(stakeManager, '500', '1000', '0')
      await expectBalance(staker1.signer, '8000', '0', '1000')
      await staker1.expectTotalStake('0.0114155', '1000', '0')

      await toNextEpoch()
      await toNextEpoch()
      await toNextEpoch()
      await staker1.restakeRewards(validator1)

      await expectBalance(stakeManager, '500', '1000', '0')
      await expectBalance(staker1.signer, '8000', '0', '1000')
      await staker1.expectTotalStake('0.045662', '1000', '0')
    })
  })

  describe('rewards and commissions', () => {
    beforeEach(async () => {
      await initialize()
      await updateEnvironment({ startEpoch: await getEpoch(1), jailThreshold: 120 })
      await toNextEpoch()
    })

    it('when operating ratio is 100%', async () => {
      const startingEpoch = await getEpoch(0)

      await staker1.stake(Token.OAS, validator1, '1000')
      await staker2.stake(Token.OAS, validator1, '2000')
      await toNextEpoch()

      await staker1.claimRewards(validator1, 0)
      await staker2.claimRewards(validator1, 0)
      await validator1.claimCommissions()

      await toNextEpoch() // 1
      await updateEnvironment({ startEpoch: await getEpoch(1), commissionRate: 10 })
      await staker1.stake(Token.wOAS, validator1, '500')
      await staker2.stake(Token.sOAS, validator1, '500')
      await toNextEpoch() // 2
      await toNextEpoch() // 3
      await toNextEpoch() // 4
      await updateEnvironment({ startEpoch: await getEpoch(1), commissionRate: 50 })
      await staker1.stake(Token.wOAS, validator1, '250')
      await staker1.stake(Token.sOAS, validator1, '250')
      await staker2.stake(Token.wOAS, validator1, '250')
      await staker2.stake(Token.sOAS, validator1, '250')
      await toNextEpoch() // 5
      await toNextEpoch() // 6
      await toNextEpoch() // 7
      await updateEnvironment({ startEpoch: await getEpoch(1), commissionRate: 100 })
      await toNextEpoch() // 8
      await toNextEpoch() // 9
      await staker1.unstakeV2(Token.OAS, validator1, '500')
      await staker1.unstakeV2(Token.wOAS, validator1, '500')
      await staker2.unstakeV2(Token.OAS, validator1, '500')
      await staker2.unstakeV2(Token.sOAS, validator1, '500')
      await updateEnvironment({ startEpoch: await getEpoch(1), commissionRate: 10 })
      await toNextEpoch() // 10
      await updateEnvironment({ startEpoch: startingEpoch + 12, rewardRate: 50 })

      await staker1.expectRewards('0.01141552', validator1, 1)
      await staker2.expectRewards('0.02283105', validator1, 1)
      await validator1.expectCommissions('0', 1)

      await staker1.expectRewards('0.02283105', validator1, 2)
      await staker2.expectRewards('0.04566210', validator1, 2)
      await validator1.expectCommissions('0', 2)

      await staker1.expectRewards('0.03824200', validator1, 3)
      await staker2.expectRewards('0.07134703', validator1, 3)
      await validator1.expectCommissions('0.00456621', 3)

      await staker1.expectRewards('0.05365296', validator1, 4)
      await staker2.expectRewards('0.09703196', validator1, 4)
      await validator1.expectCommissions('0.00913242', 4)

      await staker1.expectRewards('0.06906392', validator1, 5)
      await staker2.expectRewards('0.12271689', validator1, 5)
      await validator1.expectCommissions('0.01369863', 5)

      await staker1.expectRewards('0.08047945', validator1, 6)
      await staker2.expectRewards('0.13984018', validator1, 6)
      await validator1.expectCommissions('0.04223744', 6)

      await staker1.expectRewards('0.09189497', validator1, 7)
      await staker2.expectRewards('0.15696347', validator1, 7)
      await validator1.expectCommissions('0.07077625', 7)

      await staker1.expectRewards('0.10331050', validator1, 8)
      await staker2.expectRewards('0.17408675', validator1, 8)
      await validator1.expectCommissions('0.09931506', 8)

      await staker1.expectRewards('0.10331050', validator1, 9)
      await staker2.expectRewards('0.17408675', validator1, 9)
      await validator1.expectCommissions('0.15639269', 9)

      await staker1.expectRewards('0.10331050', validator1, 10)
      await staker2.expectRewards('0.17408675', validator1, 10)
      await validator1.expectCommissions('0.21347031', 10)

      await staker1.expectRewards('0.10331050', validator1, 0)
      await staker2.expectRewards('0.17408675', validator1, 0)
      await validator1.expectCommissions('0.21347031', 0)

      await staker1.expectRewards('0.10331050', validator1, 99)
      await staker2.expectRewards('0.17408675', validator1, 99)
      await validator1.expectCommissions('0.21347031', 99)

      await expect(await staker1.claimRewards(validator1, 5))
        .to.emit(stakeManager, 'ClaimedRewards')
        .withArgs(staker1.address, validator1.owner.address, toBNWei('0.069063926940639267'))
      await staker2.claimRewards(validator1, 5)
      await validator1.claimCommissions(undefined, 5)

      const check1 = async () => {
        await expectBalance(staker1.signer, '7000.06906392', '250', '750')
        await expectBalance(staker2.signer, '6000.12271689', '750', '250')
        await expectBalance(validator1.owner, '10000.01369863', '0', '0')

        await staker1.expectRewards('0.01141552', validator1, 1)
        await staker2.expectRewards('0.01712328', validator1, 1)
        await validator1.expectCommissions('0.02853881', 1)

        await staker1.expectRewards('0.02283105', validator1, 2)
        await staker2.expectRewards('0.03424657', validator1, 2)
        await validator1.expectCommissions('0.05707762', 2)

        await staker1.expectRewards('0.03424657', validator1, 3)
        await staker2.expectRewards('0.05136986', validator1, 3)
        await validator1.expectCommissions('0.08561643', 3)

        await staker1.expectRewards('0.03424657', validator1, 4)
        await staker2.expectRewards('0.05136986', validator1, 4)
        await validator1.expectCommissions('0.14269406', 4)

        await staker1.expectRewards('0.03424657', validator1, 5)
        await staker2.expectRewards('0.05136986', validator1, 5)
        await validator1.expectCommissions('0.19977168', 5)
      }

      await check1()

      await toNextEpoch() // 11 (6)
      await toNextEpoch() // 12 (7)
      await toNextEpoch() // 13 (8)

      await check1()

      await staker1.expectRewards('0.04452054', validator1, 6)
      await staker2.expectRewards('0.07191780', validator1, 6)
      await validator1.expectCommissions('0.20319634', 6)

      await staker1.expectRewards('0.0958904', validator1, 7)
      await staker2.expectRewards('0.17465753', validator1, 7)
      await validator1.expectCommissions('0.22031963', 7)

      await staker1.expectRewards('0.14726027', validator1, 8)
      await staker2.expectRewards('0.27739726', validator1, 8)
      await validator1.expectCommissions('0.23744292', 8)

      const check2 = async () => {
        await staker1.claimRewards(validator1, 0)
        await staker2.claimRewards(validator1, 0)
        await validator1.claimCommissions(undefined, 0)

        await expectBalance(staker1.signer, '7000.21632420', '250', '750')
        await expectBalance(staker2.signer, '6000.40011415', '750', '250')
        await expectBalance(validator1.owner, '10000.25114155', '0', '0')

        await staker1.expectRewards('0', validator1, 0)
        await staker2.expectRewards('0', validator1, 0)
        await validator1.expectCommissions('0', 0)
      }

      await check2()

      // check for double claim
      await check2()
    })

    it('when operating ratio is 50%', async () => {
      await staker1.stake(Token.OAS, validator1, '1000')
      await staker2.stake(Token.OAS, validator1, '2000')
      await updateEnvironment({ startEpoch: await getEpoch(1), commissionRate: 10 })
      await toNextEpoch()

      await staker1.claimRewards(validator1, 0)
      await staker2.claimRewards(validator1, 0)
      await validator1.claimCommissions()

      await toNextEpoch() // 1
      await slash(validator1, validator1, 60)
      await toNextEpoch() // 2
      await toNextEpoch() // 3
      await slash(validator1, validator1, 60)
      await toNextEpoch() // 4

      await staker1.expectRewards('0.01027397', validator1, 1)
      await staker2.expectRewards('0.02054794', validator1, 1)
      await validator1.expectCommissions('0.00342465', 1)

      await staker1.expectRewards('0.01541095', validator1, 2)
      await staker2.expectRewards('0.03082191', validator1, 2)
      await validator1.expectCommissions('0.00513698', 2)

      await staker1.expectRewards('0.02568493', validator1, 3)
      await staker2.expectRewards('0.05136986', validator1, 3)
      await validator1.expectCommissions('0.00856164', 3)

      await staker1.expectRewards('0.03082191', validator1, 4)
      await staker2.expectRewards('0.06164383', validator1, 4)
      await validator1.expectCommissions('0.01027397', 4)
    })

    it('when operating ratio is 0% and jailed', async () => {
      await staker1.stake(Token.OAS, validator1, '1000')
      await staker2.stake(Token.OAS, validator1, '2000')
      await updateEnvironment({ startEpoch: await getEpoch(1), commissionRate: 10 })
      await toNextEpoch()

      await staker1.claimRewards(validator1, 0)
      await staker2.claimRewards(validator1, 0)
      await validator1.claimCommissions()

      await toNextEpoch() // 1
      await slash(validator1, validator1, 120)
      await toNextEpoch() // 2 (operating ratio is 0%)
      await toNextEpoch() // 3 (jailed)
      await toNextEpoch() // 4 (jailed)
      await toNextEpoch() // 5
      await toNextEpoch() // 6
      await slash(validator1, validator1, 120)
      await toNextEpoch() // 7 (operating ratio is 0%)
      await toNextEpoch() // 8 (jailed)
      await toNextEpoch() // 9 (jailed)
      await toNextEpoch() // 10

      await staker1.expectRewards('0.01027397', validator1, 1)
      await staker2.expectRewards('0.02054794', validator1, 1)
      await validator1.expectCommissions('0.00342465', 1)

      await staker1.expectRewards('0.01027397', validator1, 2)
      await staker2.expectRewards('0.02054794', validator1, 2)
      await validator1.expectCommissions('0.00342465', 2)

      await staker1.expectRewards('0.01027397', validator1, 3)
      await staker2.expectRewards('0.02054794', validator1, 3)
      await validator1.expectCommissions('0.00342465', 3)

      await staker1.expectRewards('0.01027397', validator1, 4)
      await staker2.expectRewards('0.02054794', validator1, 4)
      await validator1.expectCommissions('0.00342465', 4)

      await staker1.expectRewards('0.02054794', validator1, 5)
      await staker2.expectRewards('0.04109589', validator1, 5)
      await validator1.expectCommissions('0.0068493', 5)

      await staker1.expectRewards('0.03082191', validator1, 6)
      await staker2.expectRewards('0.06164383', validator1, 6)
      await validator1.expectCommissions('0.01027397', 6)

      await staker1.expectRewards('0.03082191', validator1, 7)
      await staker2.expectRewards('0.06164383', validator1, 7)
      await validator1.expectCommissions('0.01027397', 7)

      await staker1.expectRewards('0.03082191', validator1, 8)
      await staker2.expectRewards('0.06164383', validator1, 8)
      await validator1.expectCommissions('0.01027397', 8)

      await staker1.expectRewards('0.03082191', validator1, 9)
      await staker2.expectRewards('0.06164383', validator1, 9)
      await validator1.expectCommissions('0.01027397', 9)

      await staker1.expectRewards('0.04109589', validator1, 10)
      await staker2.expectRewards('0.08219178', validator1, 10)
      await validator1.expectCommissions('0.01369863', 10)
    })

    it('when inactive', async () => {
      await staker1.stake(Token.OAS, validator1, '1000')
      await staker2.stake(Token.OAS, validator1, '2000')
      await updateEnvironment({ startEpoch: await getEpoch(1), commissionRate: 10 })
      await toNextEpoch()

      await staker1.claimRewards(validator1, 0)
      await staker2.claimRewards(validator1, 0)
      await validator1.claimCommissions()

      const epoch = await getEpoch(0)
      await validator1.deactivateValidator([
        epoch + 1,
        epoch + 2,
        epoch + 3,
        epoch + 4,
        epoch + 5,
        epoch + 6,
        epoch + 7,
        epoch + 8,
      ])
      await validator1.activateValidator([epoch + 4, epoch + 5])

      await toNextEpoch() // 1
      await toNextEpoch() // 2 (inactive)
      await toNextEpoch() // 3 (inactive)
      await toNextEpoch() // 4 (inactive)
      await toNextEpoch() // 5
      await toNextEpoch() // 6
      await toNextEpoch() // 7 (inactive)
      await toNextEpoch() // 8 (inactive)
      await toNextEpoch() // 9 (inactive)
      await toNextEpoch() // 10

      await staker1.expectRewards('0.01027397', validator1, 1)
      await staker2.expectRewards('0.02054794', validator1, 1)
      await validator1.expectCommissions('0.00342465', 1)

      await staker1.expectRewards('0.01027397', validator1, 2)
      await staker2.expectRewards('0.02054794', validator1, 2)
      await validator1.expectCommissions('0.00342465', 2)

      await staker1.expectRewards('0.01027397', validator1, 3)
      await staker2.expectRewards('0.02054794', validator1, 3)
      await validator1.expectCommissions('0.00342465', 3)

      await staker1.expectRewards('0.01027397', validator1, 4)
      await staker2.expectRewards('0.02054794', validator1, 4)
      await validator1.expectCommissions('0.00342465', 4)

      await staker1.expectRewards('0.02054794', validator1, 5)
      await staker2.expectRewards('0.04109589', validator1, 5)
      await validator1.expectCommissions('0.0068493', 5)

      await staker1.expectRewards('0.03082191', validator1, 6)
      await staker2.expectRewards('0.06164383', validator1, 6)
      await validator1.expectCommissions('0.01027397', 6)

      await staker1.expectRewards('0.03082191', validator1, 7)
      await staker2.expectRewards('0.06164383', validator1, 7)
      await validator1.expectCommissions('0.01027397', 7)

      await staker1.expectRewards('0.03082191', validator1, 8)
      await staker2.expectRewards('0.06164383', validator1, 8)
      await validator1.expectCommissions('0.01027397', 8)

      await staker1.expectRewards('0.03082191', validator1, 9)
      await staker2.expectRewards('0.06164383', validator1, 9)
      await validator1.expectCommissions('0.01027397', 9)

      await staker1.expectRewards('0.04109589', validator1, 10)
      await staker2.expectRewards('0.08219178', validator1, 10)
      await validator1.expectCommissions('0.01369863', 10)
    })
  })

  describe('current validator functions', () => {
    beforeEach(async () => {
      await initialize()
    })

    it('slash()', async () => {
      const startingEpoch = await getEpoch(0)
      await updateEnvironment({
        startEpoch: startingEpoch + 1,
        jailThreshold: 50,
      })
      await toNextEpoch()

      await staker1.stake(Token.OAS, validator1, '500')
      await staker1.stake(Token.OAS, validator2, '500')
      await staker1.stake(Token.OAS, validator3, '500')

      await expectCurrentValidators(validators, [false, false, false, false, true])
      await expectNextValidators(validators, [true, true, true, false, true])

      await toNextEpoch()

      await expectCurrentValidators(validators, [true, true, true, false, true])
      await expectNextValidators(validators, [true, true, true, false, true])

      await slash(validator1, validator2, 49)

      await expectCurrentValidators(validators, [true, true, true, false, true])
      await expectNextValidators(validators, [true, true, true, false, true])

      await toNextEpoch()

      await expectCurrentValidators(validators, [true, true, true, false, true])
      await expectNextValidators(validators, [true, true, true, false, true])

      await slash(validator1, validator2, 50)

      await expectCurrentValidators(validators, [true, true, true, false, true])
      await expectNextValidators(validators, [true, false, true, false, true])

      await toNextEpoch()

      await expectCurrentValidators(validators, [true, false, true, false, true])
      await expectNextValidators(validators, [true, false, true, false, true])

      await toNextEpoch()

      await expectCurrentValidators(validators, [true, false, true, false, true])
      await expectNextValidators(validators, [true, true, true, false, true])

      await toNextEpoch()

      await expectCurrentValidators(validators, [true, true, true, false, true])
      await expectNextValidators(validators, [true, true, true, false, true])
    })
  })

  describe('view functions', () => {
    beforeEach(async () => {
      await initialize()
    })

    it('getValidators()', async () => {
      const [o, x] = [true, false]

      await expectCurrentValidators(validators, [x, x, x, x, x], ['0', '0', '0', '0', '0'])
      await expectNextValidators(validators, [x, x, x, x, o], ['0', '0', '0', '0', '500'])
      await expectCurrentCandidateValidators([fixedValidator], [x], ['0'])
      await expectNextCandidateValidators([fixedValidator], [o], ['500'])

      await staker1.stake(Token.OAS, validator1, '501')
      await staker1.stake(Token.OAS, validator2, '499')
      await staker1.stake(Token.OAS, validator3, '502')

      await expectCurrentValidators(validators, [x, x, x, x, x], ['0', '0', '0', '0', '0'])
      await expectNextValidators(validators, [o, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectCurrentCandidateValidators([fixedValidator, validator1, validator3], [x, x, x], ['0', '0', '0'])
      await expectNextCandidateValidators([fixedValidator, validator1, validator3], [o, o, o], ['500', '501', '502'])

      await toNextEpoch()

      await expectCurrentValidators(validators, [o, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectNextValidators(validators, [o, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectCurrentCandidateValidators([fixedValidator, validator1, validator3], [o, o, o], ['500', '501', '502'])
      await expectNextCandidateValidators([fixedValidator, validator1, validator3], [o, o, o], ['500', '501', '502'])

      await validator1.deactivateValidator([await getEpoch(1)])

      await expectCurrentValidators(validators, [o, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectNextValidators(validators, [x, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectCurrentCandidateValidators([fixedValidator, validator1, validator3], [o, o, o], ['500', '501', '502'])
      await expectNextCandidateValidators([fixedValidator, validator1, validator3], [o, x, o], ['500', '501', '502'])

      await toNextEpoch()

      await expectCurrentValidators(validators, [x, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectNextValidators(validators, [o, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectCurrentCandidateValidators([fixedValidator, validator1, validator3], [o, x, o], ['500', '501', '502'])
      await expectNextCandidateValidators([fixedValidator, validator1, validator3], [o, o, o], ['500', '501', '502'])

      await toNextEpoch()

      await expectCurrentValidators(validators, [o, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectNextValidators(validators, [o, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectCurrentCandidateValidators([fixedValidator, validator1, validator3], [o, o, o], ['500', '501', '502'])
      await expectNextCandidateValidators([fixedValidator, validator1, validator3], [o, o, o], ['500', '501', '502'])

      await slash(validator1, validator1, 50)

      await expectCurrentValidators(validators, [o, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectNextValidators(validators, [x, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectCurrentCandidateValidators([fixedValidator, validator1, validator3], [o, o, o], ['500', '501', '502'])
      await expectNextCandidateValidators([fixedValidator, validator1, validator3], [o, x, o], ['500', '501', '502'])

      await toNextEpoch()

      await expectCurrentValidators(validators, [x, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectNextValidators(validators, [x, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectCurrentCandidateValidators([fixedValidator, validator1, validator3], [o, x, o], ['500', '501', '502'])
      await expectNextCandidateValidators([fixedValidator, validator1, validator3], [o, x, o], ['500', '501', '502'])

      await toNextEpoch()

      await expectCurrentValidators(validators, [x, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectNextValidators(validators, [o, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectCurrentCandidateValidators([fixedValidator, validator1, validator3], [o, x, o], ['500', '501', '502'])
      await expectNextCandidateValidators([fixedValidator, validator1, validator3], [o, o, o], ['500', '501', '502'])

      await toNextEpoch()

      await expectCurrentValidators(validators, [o, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectNextValidators(validators, [o, x, o, x, o], ['501', '499', '502', '0', '500'])
      await expectCurrentCandidateValidators([fixedValidator, validator1, validator3], [o, o, o], ['500', '501', '502'])
      await expectNextCandidateValidators([fixedValidator, validator1, validator3], [o, o, o], ['500', '501', '502'])

      // check pagination
      // howMany = 2
      await expectValidators(await getEpoch(0), [validator1, validator2], [o, x], ['501', '499'], ['0x', '0x'], 0, 2, 2)
      await expectValidators(await getEpoch(0), [validator3, validator4], [o, x], ['502', '0'], ['0x', '0x'], 2, 2, 4)
      await expectValidators(await getEpoch(0), [fixedValidator], [o], ['500'], ['0x'], 4, 2, 5)

      // howMany = 4
      await expectValidators(
        await getEpoch(0),
        [validator1, validator2, validator3, validator4],
        [o, x, o, x],
        ['501', '499', '502', '0'],
        ['0x', '0x', '0x', '0x'],
        0,
        4,
        4,
      )
      await expectValidators(await getEpoch(0), [fixedValidator], [o], ['500'], ['0x'], 4, 2, 5)

      // howMany = 10
      await expectValidators(
        await getEpoch(0),
        [validator1, validator2, validator3, validator4, fixedValidator],
        [o, x, o, x, o],
        ['501', '499', '502', '0', '500'],
        ['0x', '0x', '0x', '0x', '0x'],
        0,
        10,
        5,
      )
    })

    it('getHighStakeValidators()', async () => {
      const [o, x] = [true, false]

      await expectCurrentCandidateValidators([fixedValidator], [x], ['0'])
      await expectNextCandidateValidators([fixedValidator], [o], ['500'])

      await staker1.stake(Token.OAS, validator1, '550')
      await staker1.stake(Token.OAS, validator2, '450')

      await expectCurrentCandidateValidators([fixedValidator, validator1], [x, x], ['0', '0'])
      await expectNextCandidateValidators([fixedValidator, validator1], [o, o], ['500', '550'])

      await staker1.stake(Token.OAS, validator2, '150')

      await expectCurrentCandidateValidators([fixedValidator, validator1, validator2], [x, x, x], ['0', '0', '0'])
      await expectNextCandidateValidators([fixedValidator, validator1, validator2], [o, o, o], ['500', '550', '600'])

      await staker1.unstakeV2(Token.OAS, validator1, '50')

      await expectCurrentCandidateValidators([fixedValidator, validator1, validator2], [x, x, x], ['0', '0', '0'])
      await expectNextCandidateValidators([fixedValidator, validator1, validator2], [o, o, o], ['500', '500', '600'])

      await staker1.unstakeV2(Token.OAS, validator1, '1')

      await expectCurrentCandidateValidators([fixedValidator, validator2], [x, x], ['0', '0'])
      await expectNextCandidateValidators([fixedValidator, validator2], [o, o], ['500', '600'])

      await staker1.stake(Token.OAS, validator1, '51')

      await expectCurrentCandidateValidators([fixedValidator, validator2, validator1], [x, x, x], ['0', '0', '0'])
      await expectNextCandidateValidators([fixedValidator, validator2, validator1], [o, o, o], ['500', '600', '550'])

      await toNextEpoch()

      await fixedValidator.unstakeV2(Token.OAS, fixedValidator, '1')

      await expectCurrentCandidateValidators([fixedValidator, validator2, validator1], [o, o, o], ['500', '600', '550'])
      await expectNextCandidateValidators([fixedValidator, validator2, validator1], [x, o, o], ['499', '600', '550'])

      await fixedValidator.unstakeV2(Token.OAS, fixedValidator, '1')

      await expectCurrentCandidateValidators([fixedValidator, validator2, validator1], [o, o, o], ['500', '600', '550'])
      await expectNextCandidateValidators([fixedValidator, validator2, validator1], [x, o, o], ['498', '600', '550'])

      await toNextEpoch()

      await fixedValidator.unstakeV2(Token.OAS, fixedValidator, '1')

      await expectCurrentCandidateValidators([validator1, validator2], [o, o], ['550', '600'])
      await expectNextCandidateValidators([validator1, validator2], [o, o], ['550', '600'])

      await fixedValidator.stake(Token.OAS, fixedValidator, '1')

      await expectCurrentCandidateValidators([validator1, validator2], [o, o], ['550', '600'])
      await expectNextCandidateValidators([validator1, validator2], [o, o], ['550', '600'])

      await fixedValidator.stake(Token.OAS, fixedValidator, '1')

      await expectCurrentCandidateValidators([validator1, validator2], [o, o], ['550', '600'])
      await expectNextCandidateValidators([validator1, validator2], [o, o], ['550', '600'])

      await fixedValidator.stake(Token.OAS, fixedValidator, '1')

      await expectCurrentCandidateValidators([validator1, validator2, fixedValidator], [o, o, x], ['550', '600', '498'])
      await expectNextCandidateValidators([validator1, validator2, fixedValidator], [o, o, o], ['550', '600', '500'])

      await fixedValidator.unstakeV2(Token.OAS, fixedValidator, '1')

      await expectCurrentCandidateValidators([validator1, validator2], [o, o], ['550', '600'])
      await expectNextCandidateValidators([validator1, validator2], [o, o], ['550', '600'])

      await fixedValidator.stake(Token.OAS, fixedValidator, '1')

      await expectCurrentCandidateValidators([validator1, validator2, fixedValidator], [o, o, x], ['550', '600', '498'])
      await expectNextCandidateValidators([validator1, validator2, fixedValidator], [o, o, o], ['550', '600', '500'])

      await toNextEpoch()

      await staker1.unstakeV2(Token.OAS, validator1, '51')
      await fixedValidator.unstakeV2(Token.OAS, fixedValidator, '1')

      await expectCurrentCandidateValidators([validator1, validator2, fixedValidator], [o, o, o], ['550', '600', '500'])
      await expectNextCandidateValidators([validator1, validator2, fixedValidator], [x, o, x], ['499', '600', '499'])

      await staker1.stake(Token.OAS, validator2, '1')

      await expectCurrentCandidateValidators([validator1, validator2, fixedValidator], [o, o, o], ['550', '600', '500'])
      await expectNextCandidateValidators([validator1, validator2, fixedValidator], [x, o, x], ['499', '601', '499'])

      await toNextEpoch()

      await staker1.stake(Token.OAS, validator2, '1')

      await expectCurrentCandidateValidators([validator2], [o], ['601'])
      await expectNextCandidateValidators([validator2], [o], ['602'])
    })

    it('getValidatorOwners()', async () => {
      const _expect = (
        result: { owners: string[]; newCursor: BigNumber },
        expectOwners: Validator[],
        expectNewCursor: number,
      ) => {
        expect(result.owners).to.eql(expectOwners.map((x) => x.owner.address))
        expect(result.newCursor).to.equal(expectNewCursor)
      }

      // howMany = 2
      _expect(await stakeManager.getValidatorOwners(0, 2), [validator1, validator2], 2)
      _expect(await stakeManager.getValidatorOwners(2, 2), [validator3, validator4], 4)
      _expect(await stakeManager.getValidatorOwners(4, 2), [fixedValidator], 5)

      // howMany = 3
      _expect(await stakeManager.getValidatorOwners(0, 3), [validator1, validator2, validator3], 3)
      _expect(await stakeManager.getValidatorOwners(3, 3), [validator4, fixedValidator], 5)

      // howMany = 10
      _expect(
        await stakeManager.getValidatorOwners(0, 10),
        [validator1, validator2, validator3, validator4, fixedValidator],
        5,
      )
    })

    it('getStakers()', async () => {
      const _expect = (
        result: { _stakers: string[]; newCursor: BigNumber },
        expectStakers: Account[],
        expectNewCursor: number,
      ) => {
        expect(result._stakers).to.eql(expectStakers.map((x) => x.address))
        expect(result.newCursor).to.equal(expectNewCursor)
      }

      await staker1.stake(Token.OAS, validator1, '1')
      await staker2.stake(Token.OAS, validator1, '2')
      await staker3.stake(Token.OAS, validator1, '3')
      await staker4.stake(Token.OAS, validator1, '4')
      await staker5.stake(Token.OAS, validator1, '5')

      // howMany = 2
      _expect(await stakeManager.getStakers(0, 2), [fixedValidator.owner, staker1.signer], 2)
      _expect(await stakeManager.getStakers(2, 2), [staker2.signer, staker3.signer], 4)
      _expect(await stakeManager.getStakers(4, 2), [staker4.signer, staker5.signer], 6)
      _expect(await stakeManager.getStakers(6, 2), [], 6)

      // howMany = 3
      _expect(await stakeManager.getStakers(0, 3), [fixedValidator.owner, staker1.signer, staker2.signer], 3)
      _expect(await stakeManager.getStakers(3, 3), [staker3.signer, staker4.signer, staker5.signer], 6)
      _expect(await stakeManager.getStakers(6, 3), [], 6)

      // howMany = 10
      _expect(
        await stakeManager.getStakers(0, 10),
        [fixedValidator.owner, staker1.signer, staker2.signer, staker3.signer, staker4.signer, staker5.signer],
        6,
      )
    })

    it('getValidatorInfo()', async () => {
      const checker = async (active: boolean, jailed: boolean, candidate: boolean, stakes: string, epoch?: number) => {
        const acutal = await validator1.getInfo(epoch)
        if (!epoch) {
          expect(acutal.operator).to.equal(validator1.operator.address)
        }
        expect(acutal.active).to.equal(active)
        expect(acutal.jailed).to.equal(jailed)
        expect(acutal.candidate).to.equal(candidate)
        expect(fromWei(acutal.stakes.toString())).to.eql(stakes)
      }

      await checker(true, false, false, '0') // epoch 1
      await checker(true, false, false, '0', 1)
      await checker(true, false, false, '0', 2)
      await checker(true, false, false, '0', 3)

      await staker1.stake(Token.OAS, validator1, '500')
      await staker2.stake(Token.OAS, validator1, '250')

      await checker(true, false, false, '0') // epoch 1
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)

      await toNextEpoch()

      await checker(true, false, true, '750') // epoch 2
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, true, '750', 4)

      await toNextEpoch()

      await checker(true, false, true, '750') // epoch 3
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, true, '750', 4)
      await checker(true, false, true, '750', 5)

      await staker1.unstakeV2(Token.OAS, validator1, '200')
      await staker2.unstakeV2(Token.OAS, validator1, '100')

      await checker(true, false, true, '750') // epoch 3
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, false, '450', 4)
      await checker(true, false, false, '450', 5)

      await toNextEpoch()

      await checker(true, false, false, '450') // epoch 4
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, false, '450', 4)
      await checker(true, false, false, '450', 5)
      await checker(true, false, false, '450', 6)

      await staker1.stake(Token.OAS, validator1, '50')

      await checker(true, false, false, '450') // epoch 4
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, false, '450', 4)
      await checker(true, false, true, '500', 5)
      await checker(true, false, true, '500', 6)

      await toNextEpoch()

      await checker(true, false, true, '500') // epoch 5
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, false, '450', 4)
      await checker(true, false, true, '500', 5)
      await checker(true, false, true, '500', 6)
      await checker(true, false, true, '500', 7)

      // mark
      const epoch: number = await getEpoch(0)
      await validator1.deactivateValidator([epoch + 1, epoch + 2])

      await checker(true, false, true, '500') // epoch 5
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, false, '450', 4)
      await checker(true, false, true, '500', 5)
      await checker(false, false, false, '500', 6)
      await checker(false, false, false, '500', 7)

      await toNextEpoch()

      await checker(false, false, false, '500') // epoch 6
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, false, '450', 4)
      await checker(true, false, true, '500', 5)
      await checker(false, false, false, '500', 6)
      await checker(false, false, false, '500', 7)
      await checker(true, false, true, '500', 8)

      await toNextEpoch()

      await checker(false, false, false, '500') // epoch 7
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, false, '450', 4)
      await checker(true, false, true, '500', 5)
      await checker(false, false, false, '500', 6)
      await checker(false, false, false, '500', 7)
      await checker(true, false, true, '500', 8)
      await checker(true, false, true, '500', 9)

      await toNextEpoch()

      await checker(true, false, true, '500') // epoch 8
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, false, '450', 4)
      await checker(true, false, true, '500', 5)
      await checker(false, false, false, '500', 6)
      await checker(false, false, false, '500', 7)
      await checker(true, false, true, '500', 8)
      await checker(true, false, true, '500', 9)
      await checker(true, false, true, '500', 10)

      await slash(validator1, validator1, 50)

      await checker(true, false, true, '500') // epoch 8
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, false, '450', 4)
      await checker(true, false, true, '500', 5)
      await checker(false, false, false, '500', 6)
      await checker(false, false, false, '500', 7)
      await checker(true, false, true, '500', 8)
      await checker(true, true, false, '500', 9)
      await checker(true, true, false, '500', 10)
      await checker(true, false, true, '500', 11)

      await toNextEpoch()

      await checker(true, true, false, '500') // epoch 9
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, false, '450', 4)
      await checker(true, false, true, '500', 5)
      await checker(false, false, false, '500', 6)
      await checker(false, false, false, '500', 7)
      await checker(true, false, true, '500', 8)
      await checker(true, true, false, '500', 9)
      await checker(true, true, false, '500', 10)
      await checker(true, false, true, '500', 11)

      await toNextEpoch()

      await checker(true, true, false, '500') // epoch 10
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, false, '450', 4)
      await checker(true, false, true, '500', 5)
      await checker(false, false, false, '500', 6)
      await checker(false, false, false, '500', 7)
      await checker(true, false, true, '500', 8)
      await checker(true, true, false, '500', 9)
      await checker(true, true, false, '500', 10)
      await checker(true, false, true, '500', 11)

      await toNextEpoch()

      await checker(true, false, true, '500') // epoch 11
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, false, '450', 4)
      await checker(true, false, true, '500', 5)
      await checker(false, false, false, '500', 6)
      await checker(false, false, false, '500', 7)
      await checker(true, false, true, '500', 8)
      await checker(true, true, false, '500', 9)
      await checker(true, true, false, '500', 10)
      await checker(true, false, true, '500', 11)
      await checker(true, false, true, '500', 12)

      await toNextEpoch()

      await checker(true, false, true, '500') // epoch 12
      await checker(true, false, false, '0', 1)
      await checker(true, false, true, '750', 2)
      await checker(true, false, true, '750', 3)
      await checker(true, false, false, '450', 4)
      await checker(true, false, true, '500', 5)
      await checker(false, false, false, '500', 6)
      await checker(false, false, false, '500', 7)
      await checker(true, false, true, '500', 8)
      await checker(true, true, false, '500', 9)
      await checker(true, true, false, '500', 10)
      await checker(true, false, true, '500', 11)
      await checker(true, false, true, '500', 12)
    })

    xit('[OBSOLETED] getUnstakes()', async () => {
      const check = async (expOAS: number, expWOAS: number, expSOAS: number) => {
        const acutal = await staker1.getUnstakes()
        expect(fromWei(acutal.oasUnstakes.toString())).to.eql('' + expOAS)
        expect(fromWei(acutal.woasUnstakes.toString())).to.eql('' + expWOAS)
        expect(fromWei(acutal.soasUnstakes.toString())).to.eql('' + expSOAS)
      }

      await check(0, 0, 0)

      await staker1.stake(Token.OAS, validator1, '10')
      await staker1.stake(Token.wOAS, validator1, '20')
      await staker1.stake(Token.sOAS, validator1, '30')

      await toNextEpoch()
      await check(0, 0, 0)

      await staker1.unstake(Token.OAS, validator1, '1')

      await toNextEpoch()
      await check(1, 0, 0)

      await staker1.unstake(Token.wOAS, validator1, '2')

      await toNextEpoch()
      await check(1, 2, 0)

      await staker1.unstake(Token.sOAS, validator1, '3')

      await toNextEpoch()
      await check(1, 2, 3)

      await staker1.claimUnstakes()
      await check(0, 0, 0)
    })

    it('getLockedUnstakeCount()', async () => {
      await staker1.stake(Token.OAS, validator1, '10')
      expect(await staker1.getLockedUnstakeCount()).to.equal(0)

      await staker1.unstakeV2(0, validator1, '1')
      await staker1.unstakeV2(0, validator1, '1')
      await staker1.unstakeV2(0, validator1, '1')
      expect(await staker1.getLockedUnstakeCount()).to.equal(3)
    })

    it('getLockedUnstake()', async () => {
      const expectLockedUnstake = async (
        staker: Staker,
        requestIndex: number,
        expToken: number,
        expAmount: string,
        expUnlockTime: number,
        expClaimable: boolean,
      ) => {
        const actual = await staker.getLockedUnstake(requestIndex)
        expect(actual.token).to.equal(expToken)
        expect(fromWei(actual.amount.toString())).to.equal(expAmount)
        expect(actual.unlockTime).to.equal(expUnlockTime)
        expect(actual.claimable).to.equal(expClaimable)
      }

      const calcBlockTime = async (tx: any, add: number) => {
        const block = await ethers.provider.getBlock(tx.blockNumber)
        return block.timestamp + add
      }

      await staker1.stake(Token.OAS, validator1, '10')
      await staker1.stake(Token.wOAS, validator1, '10')

      const tx1 = await staker1.unstakeV2(0, validator1, '1')
      const block = await ethers.provider.getBlock('latest')

      await toNextEpoch()
      const tx2 = await staker1.unstakeV2(1, validator1, '2')

      await expectLockedUnstake(staker1, 0, Token.OAS, '1', await calcBlockTime(tx1, 864000), false)
      await expectLockedUnstake(staker1, 1, Token.wOAS, '2', await calcBlockTime(tx2, 864000), false)

      await network.provider.send('evm_setNextBlockTimestamp', [block.timestamp + 864000])
      await network.provider.send('evm_mine')

      await expectLockedUnstake(staker1, 0, Token.OAS, '1', await calcBlockTime(tx1, 864000), true)
      await expectLockedUnstake(staker1, 1, Token.wOAS, '2', await calcBlockTime(tx2, 864000), false)

      await staker1.claimLockedUnstake(0)
      await expect(staker1.claimLockedUnstake(1)).to.revertedWith('Locked')

      await expectLockedUnstake(staker1, 0, Token.OAS, '1', 0, false)
      await expectLockedUnstake(staker1, 1, Token.wOAS, '2', await calcBlockTime(tx2, 864000), false)
    })

    it('getLockedUnstakes()', async () => {
      const range = (n: number) => [...Array(n).keys()]
      const block = await ethers.provider.getBlock('latest')

      await staker1.stake(Token.OAS, validator1, '1275')

      for (let i = 1; i <= 25; i++) {
        await staker1.unstakeV2(0, validator1, String(i))
      }

      let actual1 = await staker1.getLockedUnstakes(0, 10)
      let actual2 = await staker1.getLockedUnstakes(10, 10)
      let actual3 = await staker1.getLockedUnstakes(20, 10)
      const actual4 = await staker1.getLockedUnstakes(25, 10)

      expect(actual1.tokens).to.eql(range(10).map((_) => Token.OAS))
      expect(actual2.tokens).to.eql(range(10).map((_) => Token.OAS))
      expect(actual3.tokens).to.eql(range(5).map((_) => Token.OAS))
      expect(actual4.tokens).to.eql([])

      expect(actual1.amounts).to.eql(range(10).map((x) => toBNWei(String(x + 1))))
      expect(actual2.amounts).to.eql(range(10).map((x) => toBNWei(String(x + 11))))
      expect(actual3.amounts).to.eql(range(5).map((x) => toBNWei(String(x + 21))))
      expect(actual4.amounts).to.eql([])

      expect(actual1.unlockTimes).to.satisfy((times: BigNumber[]) =>
        times.every((x) => x.toNumber() > block.timestamp + 864000),
      )
      expect(actual2.unlockTimes).to.satisfy((times: BigNumber[]) =>
        times.every((x) => x.toNumber() > block.timestamp + 864000),
      )
      expect(actual3.unlockTimes).to.satisfy((times: BigNumber[]) =>
        times.every((x) => x.toNumber() > block.timestamp + 864000),
      )
      expect(actual4.unlockTimes).to.eql([])

      expect(actual1.claimable).to.satisfies((x: boolean[]) => x.every((y) => !y))
      expect(actual2.claimable).to.satisfies((x: boolean[]) => x.every((y) => !y))
      expect(actual3.claimable).to.satisfies((x: boolean[]) => x.every((y) => !y))
      expect(actual4.claimable).to.eql([])

      expect(actual1.newCursor).to.equal(10)
      expect(actual2.newCursor).to.equal(20)
      expect(actual3.newCursor).to.equal(25)
      expect(actual4.newCursor).to.equal(25)

      await network.provider.send('evm_setNextBlockTimestamp', [block.timestamp + 864100])
      await network.provider.send('evm_mine')

      actual1 = await staker1.getLockedUnstakes(0, 10)
      expect(actual1.claimable).to.satisfies((x: boolean[]) => x.every((y) => y))

      await Promise.all(range(10).map((x) => staker1.claimLockedUnstake(x)))

      actual1 = await staker1.getLockedUnstakes(0, 10)
      expect(actual1.unlockTimes).to.satisfy((times: BigNumber[]) => times.every((x) => x.toNumber() == 0))
    })

    it('getValidatorStakes(address,uint256,uint256,uint256)', async () => {
      await staker1.stake(Token.OAS, validator1, '10')
      await toNextEpoch()

      await staker2.stake(Token.OAS, validator1, '20')
      await toNextEpoch()

      await staker1.stake(Token.OAS, validator1, '30')
      await staker3.stake(Token.OAS, validator1, '30')
      await toNextEpoch()

      await staker4.stake(Token.OAS, validator1, '40')
      await staker5.stake(Token.OAS, validator1, '50')
      await staker6.stake(Token.OAS, validator1, '60')
      await toNextEpoch()

      await staker2.unstakeV2(Token.OAS, validator1, '20')
      await toNextEpoch()

      await validator1.expectStakes(
        1,
        [staker1, staker2, staker3, staker4, staker5, staker6],
        ['0', '0', '0', '0', '0', '0'],
      )
      await validator1.expectStakes(
        2,
        [staker1, staker2, staker3, staker4, staker5, staker6],
        ['10', '0', '0', '0', '0', '0'],
      )
      await validator1.expectStakes(
        3,
        [staker1, staker2, staker3, staker4, staker5, staker6],
        ['10', '20', '0', '0', '0', '0'],
      )
      await validator1.expectStakes(
        4,
        [staker1, staker2, staker3, staker4, staker5, staker6],
        ['40', '20', '30', '0', '0', '0'],
      )
      await validator1.expectStakes(
        5,
        [staker1, staker2, staker3, staker4, staker5, staker6],
        ['40', '20', '30', '40', '50', '60'],
      )
      await validator1.expectStakes(
        6,
        [staker1, staker2, staker3, staker4, staker5, staker6],
        ['40', '0', '30', '40', '50', '60'],
      )
      await validator1.expectStakes(
        0,
        [staker1, staker2, staker3, staker4, staker5, staker6],
        ['40', '0', '30', '40', '50', '60'],
      )

      // check pagination
      // howMany = 2
      await validator1.expectStakes(0, [staker1, staker2], ['40', '0'], 0, 2, 2)
      await validator1.expectStakes(0, [staker3, staker4], ['30', '40'], 2, 2, 4)
      await validator1.expectStakes(0, [staker5, staker6], ['50', '60'], 4, 2, 6)
      await validator1.expectStakes(0, [], [], 6, 2, 6)

      // howMany = 3
      await validator1.expectStakes(0, [staker1, staker2, staker3], ['40', '0', '30'], 0, 3, 3)
      await validator1.expectStakes(0, [staker4, staker5, staker6], ['40', '50', '60'], 3, 3, 6)
      await validator1.expectStakes(0, [], [], 6, 3, 6)

      // howMany = 10
      await validator1.expectStakes(
        0,
        [staker1, staker2, staker3, staker4, staker5, staker6],
        ['40', '0', '30', '40', '50', '60'],
        0,
        10,
        6,
      )
    })

    it('getValidatorStakes(address,uint256) and getOperatorStakes()', async () => {
      const check = async (validator: Validator, epoch: number, exp: string) => {
        const actual1 = await stakeManager['getValidatorStakes(address,uint256)'](validator.owner.address, epoch)
        const actual2 = await stakeManager.getOperatorStakes(validator.operator.address, epoch)
        expect(actual1.toString()).to.equal(toWei(exp))
        expect(actual2.toString()).to.equal(toWei(exp))
      }

      await staker1.stake(Token.OAS, validator1, '10')
      await toNextEpoch()

      await staker2.stake(Token.OAS, validator1, '20')
      await toNextEpoch()

      await staker1.stake(Token.OAS, validator1, '30')
      await staker3.stake(Token.OAS, validator1, '30')
      await toNextEpoch()

      await staker4.stake(Token.OAS, validator1, '40')
      await staker5.stake(Token.OAS, validator1, '50')
      await staker6.stake(Token.OAS, validator1, '60')
      await toNextEpoch()

      await staker2.unstakeV2(Token.OAS, validator1, '20')
      await toNextEpoch()

      await check(validator1, 1, '0')
      await check(validator1, 2, '10')
      await check(validator1, 3, '30')
      await check(validator1, 4, '90')
      await check(validator1, 5, '240')
      await check(validator1, 6, '220')
      await check(validator1, 0, '220')
    })

    it('getStakerStakes()', async () => {
      await staker1.stake(Token.OAS, validator1, '5')
      await staker1.stake(Token.OAS, validator1, '5')
      await staker1.stake(Token.OAS, validator2, '10')
      await staker1.stake(Token.wOAS, validator2, '10')
      await staker1.stake(Token.OAS, validator4, '15')
      await staker1.stake(Token.wOAS, validator4, '15')
      await staker1.stake(Token.OAS, validator4, '20')
      await staker1.stake(Token.sOAS, validator4, '20')

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      await toNextEpoch()

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['10', '10', '0', '35', '0'],
          ['0', '10', '0', '15', '0'],
          ['0', '0', '0', '20', '0'],
        ],
      )

      await staker1.unstakeV2(Token.OAS, validator1, '1')
      await staker1.unstakeV2(Token.OAS, validator1, '1')
      await staker1.unstakeV2(Token.OAS, validator2, '2')
      await staker1.unstakeV2(Token.wOAS, validator2, '1')
      await staker1.unstakeV2(Token.OAS, validator4, '3')
      await staker1.unstakeV2(Token.sOAS, validator4, '1')

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['10', '10', '0', '35', '0'],
          ['0', '10', '0', '15', '0'],
          ['0', '0', '0', '20', '0'],
        ],
      )

      await toNextEpoch()

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['8', '8', '0', '32', '0'],
          ['0', '9', '0', '15', '0'],
          ['0', '0', '0', '19', '0'],
        ],
      )

      await staker1.stake(Token.wOAS, validator1, '1')
      await staker1.stake(Token.sOAS, validator2, '2')
      await staker1.stake(Token.OAS, validator4, '3')
      await staker1.stake(Token.OAS, validator1, '10')
      await staker1.stake(Token.wOAS, validator2, '20')
      await staker1.stake(Token.sOAS, validator4, '30')
      await staker1.unstakeV2(Token.OAS, validator1, '10')
      await staker1.unstakeV2(Token.wOAS, validator2, '20')
      await staker1.unstakeV2(Token.sOAS, validator4, '30')

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['8', '8', '0', '32', '0'],
          ['0', '9', '0', '15', '0'],
          ['0', '0', '0', '19', '0'],
        ],
      )

      await toNextEpoch()

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['8', '8', '0', '35', '0'],
          ['1', '9', '0', '15', '0'],
          ['0', '2', '0', '19', '0'],
        ],
      )

      await staker1.stake(Token.OAS, validator1, '10')
      await staker1.stake(Token.wOAS, validator2, '20')
      await staker1.stake(Token.sOAS, validator4, '30')

      await staker1.unstakeV2(Token.OAS, validator1, '5')
      await staker1.unstakeV2(Token.wOAS, validator2, '10')
      await staker1.unstakeV2(Token.sOAS, validator4, '15')

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['8', '8', '0', '35', '0'],
          ['1', '9', '0', '15', '0'],
          ['0', '2', '0', '19', '0'],
        ],
      )

      await toNextEpoch()

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['13', '8', '0', '35', '0'],
          ['1', '19', '0', '15', '0'],
          ['0', '2', '0', '34', '0'],
        ],
      )

      await staker1.expectStakes(
        1,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      await staker1.expectStakes(
        2,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['10', '10', '0', '35', '0'],
          ['0', '10', '0', '15', '0'],
          ['0', '0', '0', '20', '0'],
        ],
      )

      await staker1.expectStakes(
        3,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['8', '8', '0', '32', '0'],
          ['0', '9', '0', '15', '0'],
          ['0', '0', '0', '19', '0'],
        ],
      )

      await staker1.expectStakes(
        4,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['8', '8', '0', '35', '0'],
          ['1', '9', '0', '15', '0'],
          ['0', '2', '0', '19', '0'],
        ],
      )

      // check pagination
      // howMany = 2
      await staker1.expectStakes(
        4,
        [validator1, validator2],
        [
          ['8', '8'],
          ['1', '9'],
          ['0', '2'],
        ],
        0,
        2,
        2,
      )
      await staker1.expectStakes(
        4,
        [validator3, validator4],
        [
          ['0', '35'],
          ['0', '15'],
          ['0', '19'],
        ],
        2,
        2,
        4,
      )
      await staker1.expectStakes(4, [fixedValidator], [['0'], ['0'], ['0']], 4, 2, 5)

      // howMany = 3
      await staker1.expectStakes(
        4,
        [validator1, validator2, validator3],
        [
          ['8', '8', '0'],
          ['1', '9', '0'],
          ['0', '2', '0'],
        ],
        0,
        3,
        3,
      )
      await staker1.expectStakes(
        4,
        [validator4, fixedValidator],
        [
          ['35', '0'],
          ['15', '0'],
          ['19', '0'],
        ],
        3,
        3,
        5,
      )

      // howMany = 10
      await staker1.expectStakes(
        4,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['8', '8', '0', '35', '0'],
          ['1', '9', '0', '15', '0'],
          ['0', '2', '0', '19', '0'],
        ],
        0,
        10,
        5,
      )
    })

    it('getBlockAndSlashes()', async () => {
      await staker1.stake(Token.OAS, validator1, '500')
      await staker1.stake(Token.OAS, validator2, '500')

      await toNextEpoch()
      await toNextEpoch()

      await slash(validator1, validator2, 10)

      await toNextEpoch()
      await toNextEpoch()
      await toNextEpoch()

      await slash(validator1, validator2, 20)

      await toNextEpoch()

      await validator2.expectSlashes(1, 0, 0)
      await validator2.expectSlashes(2, 0, 0)
      await validator2.expectSlashes(3, 80, 10)
      await validator2.expectSlashes(4, 0, 0)
      await validator2.expectSlashes(5, 0, 0)
      await validator2.expectSlashes(6, 80, 20)
      await validator2.expectSlashes(7, 0, 0) // current epoch
    })

    it('getTotalStake()', async () => {
      const checker = async (epoch: number, expect_: string) => {
        const actual = await stakeManager.getTotalStake(epoch)
        expect(fromWei(actual.toString())).to.eql(expect_)
      }

      await checker(0, '0')
      await checker(2, '500')

      await staker1.stake(Token.OAS, validator1, '10')

      await checker(0, '0')
      await checker(2, '510')

      await toNextEpoch()

      await checker(0, '510')
      await checker(3, '510')

      await staker1.stake(Token.OAS, validator1, '20')

      await checker(0, '510')
      await checker(3, '530')

      await toNextEpoch()

      await checker(0, '530')
      await checker(4, '530')

      await staker1.unstakeV2(Token.OAS, validator1, '1')

      await checker(0, '530')
      await checker(4, '529')

      await toNextEpoch()

      await checker(0, '529')
      await checker(5, '529')

      await staker1.unstakeV2(Token.OAS, validator1, '2')

      await checker(0, '529')
      await checker(5, '527')

      await toNextEpoch()

      await checker(0, '527')
      await checker(6, '527')

      await staker1.stake(Token.OAS, validator1, '30')

      await checker(0, '527')
      await checker(6, '557')

      await staker1.unstakeV2(Token.OAS, validator1, '3')

      await checker(0, '527')
      await checker(6, '554')

      await toNextEpoch()

      await checker(0, '554')
      await checker(7, '554')
    })

    it('getTotalRewards()', async () => {
      const checker = async (validators: Validator[], epochs: number, expectEther: string) => {
        let actual: BigNumber = await stakeManager.getTotalRewards(
          validators.map((x) => x.owner.address),
          epochs,
        )
        expect(fromWei(actual.toString())).to.match(new RegExp(`^${expectEther}`))
      }

      await staker1.stake(Token.OAS, validator1, '1000')
      await staker2.stake(Token.OAS, validator2, '2000')
      await toNextEpoch()

      await toNextEpoch() // 1

      await staker1.stake(Token.OAS, validator1, '500')
      await staker2.stake(Token.OAS, validator2, '500')

      await toNextEpoch() // 3
      await toNextEpoch() // 4

      await staker1.unstakeV2(Token.OAS, validator1, '250')
      await staker2.unstakeV2(Token.OAS, validator2, '250')

      await toNextEpoch() // 5
      await toNextEpoch() // 6

      await checker([fixedValidator], 1, '0.00570776')
      await checker([fixedValidator], 2, '0.01141552')
      await checker([fixedValidator], 3, '0.01712328')
      await checker([fixedValidator], 4, '0.02283105')
      await checker([fixedValidator], 5, '0.02853881')

      await checker([fixedValidator, validator1, validator2], 1, '0.0456621')
      await checker([fixedValidator, validator1, validator2], 2, '0.0970319')
      await checker([fixedValidator, validator1, validator2], 3, '0.1484018')
      await checker([fixedValidator, validator1, validator2], 4, '0.1883561')
      await checker([fixedValidator, validator1, validator2], 5, '0.2283105')
    })
  })
})
