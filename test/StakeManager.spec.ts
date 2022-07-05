import { ethers, network } from 'hardhat'
import { Contract, BigNumber } from 'ethers'
import { SignerWithAddress as Account } from '@nomiclabs/hardhat-ethers/signers'
import { toWei, fromWei } from 'web3-utils'
import { expect } from 'chai'

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
} from './helpers'

const initialEnv: EnvironmentValue = {
  startBlock: 0,
  startEpoch: 0,
  blockPeriod: 15,
  epochPeriod: 240,
  rewardRate: 10,
  validatorThreshold: toWei('500'),
  jailThreshold: 50,
  jailPeriod: 2,
}

describe('StakeManager', () => {
  let accounts: Account[]
  let stakeManager: Contract
  let environment: Contract
  let allowlist: Contract
  let woas: Contract
  let soas: Contract

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

  const expectCurrentValidators = async (expectValidators: Validator[], expectStakes?: string[]) => {
    _expectValidators(await stakeManager.getCurrentValidators(), expectValidators, expectStakes)
  }

  const expectNextValidators = async (expectValidators: Validator[], expectStakes?: string[]) => {
    _expectValidators(await stakeManager.getNextValidators(), expectValidators, expectStakes)
  }

  const _expectValidators = (values: any, expectValidators: Validator[], expectStakes?: string[]) => {
    const { owners, operators, stakes } = values
    expect(owners).to.eql(expectValidators.map((x) => x.owner.address))
    expect(operators).to.eql(expectValidators.map((x) => x.operator.address))
    if (expectStakes) {
      expect(stakes.map((x: any) => fromWei(x.toString()))).to.eql(expectStakes)
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

  const allowAddress = async (validator: Validator) => {
    await allowlist.connect(deployer).addAddress(validator.owner.address)
  }

  const initializeContracts = async () => {
    await environment.initialize(initialEnv)
    await stakeManager.initialize(environment.address, allowlist.address)
  }

  const initializeValidators = async () => {
    await Promise.all(validators.map((x) => allowAddress(x)))
    await Promise.all(validators.map((x) => x.joinValidator()))
    await fixedValidator.stake(Token.OAS, fixedValidator, '500')
  }

  const initialize = async () => {
    await initializeContracts()
    await initializeValidators()
  }

  const toNextEpoch = async () => {
    currentBlock += initialEnv.epochPeriod
    await mining(currentBlock)
  }

  const setCoinbase = async (address: string) => {
    const current = await network.provider.send('eth_coinbase')
    await network.provider.send('hardhat_setCoinbase', [address])
    return async () => await network.provider.send('hardhat_setCoinbase', [current])
  }

  const updateEnvironment = async (diff: object) => {
    const restoreCoinbase = await setCoinbase(fixedValidator.operator.address)
    await environment.connect(fixedValidator.operator).updateValue({
      ...(await environment.value()),
      ...diff,
    })
    await restoreCoinbase()
  }

  const slash = async (validator: Validator, target: Validator, count: number) => {
    const env = await environment.value()
    const { operators } = await stakeManager.getCurrentValidators()
    const blocks = ~~(env.epochPeriod / operators.length)

    const restoreCoinbase = await setCoinbase(validator.operator.address)
    await Promise.all([...Array(count).keys()].map((_) => validator.slash(target, blocks)))
    await restoreCoinbase()
  }

  before(async () => {
    accounts = await ethers.getSigners()
    deployer = accounts[0]
  })

  beforeEach(async () => {
    await network.provider.send('hardhat_reset')
    await network.provider.send('hardhat_setCoinbase', [accounts[0].address])
    await network.provider.send('hardhat_setCode', [WOASAddress, TestERC20Bytecode])
    await network.provider.send('hardhat_setCode', [SOASAddress, TestERC20Bytecode])

    environment = await (await ethers.getContractFactory('Environment')).connect(deployer).deploy()
    allowlist = await (await ethers.getContractFactory('Allowlist')).connect(deployer).deploy()
    stakeManager = await (await ethers.getContractFactory('StakeManager')).connect(deployer).deploy()

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

    woas = (await ethers.getContractFactory('TestERC20')).attach(WOASAddress)
    soas = (await ethers.getContractFactory('TestERC20')).attach(SOASAddress)
    await Promise.all(stakers.map((x) => woas.connect(x.signer).mint({ value: toWei('1000') })))
    await Promise.all(stakers.map((x) => soas.connect(x.signer).mint({ value: toWei('1000') })))
    await Promise.all(stakers.map((x) => woas.connect(x.signer).approve(stakeManager.address, toWei('1000'))))
    await Promise.all(stakers.map((x) => soas.connect(x.signer).approve(stakeManager.address, toWei('1000'))))

    currentBlock = 0
  })

  it('initialize()', async () => {
    await initialize()
    await expect(initialize()).to.revertedWith('already initialized.')
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
      await initializeContracts()
    })

    it('joinValidator()', async () => {
      let tx = validator.joinValidator(zeroAddress)
      await expect(tx).to.revertedWith('not allowed.')

      await allowAddress(validator)

      tx = validator.joinValidator(zeroAddress)
      await expect(tx).to.revertedWith('operator is zero address.')

      tx = validator.joinValidator(owner.address)
      await expect(tx).to.revertedWith('operator is same as owner.')

      await validator.joinValidator()

      tx = validator.joinValidator()
      await expect(tx).to.revertedWith('already joined.')
    })

    it('updateOperator()', async () => {
      const newOperator = accounts[accounts.length - 3]

      await allowAddress(validator)
      await validator.joinValidator()

      let tx = validator.updateOperator(zeroAddress)
      await expect(tx).to.revertedWith('operator is zero address.')

      tx = validator.updateOperator(owner.address)
      await expect(tx).to.revertedWith('operator is same as owner.')

      // from owner
      await validator.updateOperator(newOperator.address)
      expect((await validator.getInfo()).operator).to.equal(newOperator.address)

      // from operator
      tx = validator.updateOperator(operator.address, operator)
      await expect(tx).to.revertedWith('validator does not exist.')

      // from attacker
      tx = validator.updateOperator(attacker.address, attacker)
      await expect(tx).to.revertedWith('validator does not exist.')
    })

    it('deactivateValidator() and activateValidator()', async () => {
      const getEpoch = async (incr: number) => (await environment.epoch()).toNumber() + incr

      await allowAddress(validator)
      await validator.joinValidator()
      await staker1.stake(Token.OAS, validator, '500')

      await expectCurrentValidators([], [])
      await expectNextValidators([validator], ['500'])
      expect((await validator.getInfo()).active).to.be.true

      await toNextEpoch()

      await expectCurrentValidators([validator], ['500'])
      await expectNextValidators([validator], ['500'])
      expect((await validator.getInfo()).active).to.be.true

      // from owner
      let nextEpoch = await getEpoch(1)
      await validator.deactivateValidator([nextEpoch], owner)

      await expectCurrentValidators([validator], ['500'])
      await expectNextValidators([], [])
      expect((await validator.getInfo()).active).to.be.true

      await toNextEpoch()

      await expectCurrentValidators([], [])
      await expectNextValidators([validator], ['500'])
      expect((await validator.getInfo()).active).to.be.false

      await toNextEpoch()

      await expectCurrentValidators([validator], ['500'])
      await expectNextValidators([validator], ['500'])
      expect((await validator.getInfo()).active).to.be.true

      nextEpoch = await getEpoch(1)
      await validator.deactivateValidator([nextEpoch + 1, nextEpoch + 2, nextEpoch + 3], owner)
      await validator.activateValidator([nextEpoch + 2])

      await expectCurrentValidators([validator], ['500'])
      await expectNextValidators([validator], ['500'])
      expect((await validator.getInfo()).active).to.be.true

      await toNextEpoch()

      await expectCurrentValidators([validator], ['500'])
      await expectNextValidators([], [])
      expect((await validator.getInfo()).active).to.be.true

      await toNextEpoch()

      await expectCurrentValidators([], [])
      await expectNextValidators([validator], ['500'])
      expect((await validator.getInfo()).active).to.be.false

      await toNextEpoch()

      await expectCurrentValidators([validator], ['500'])
      await expectNextValidators([], [])
      expect((await validator.getInfo()).active).to.be.true

      await toNextEpoch()

      await expectCurrentValidators([], [])
      await expectNextValidators([validator], ['500'])
      expect((await validator.getInfo()).active).to.be.false

      await toNextEpoch()

      await expectCurrentValidators([validator], ['500'])
      await expectNextValidators([validator], ['500'])
      expect((await validator.getInfo()).active).to.be.true

      // from operator
      await validator.deactivateValidator([await getEpoch(1)], operator)

      await expectCurrentValidators([validator], ['500'])
      await expectNextValidators([], [])
      expect((await validator.getInfo()).active).to.be.true

      await toNextEpoch()

      await expectCurrentValidators([], [])
      await expectNextValidators([validator], ['500'])
      expect((await validator.getInfo()).active).to.be.false

      await toNextEpoch()

      await expectCurrentValidators([validator], ['500'])
      await expectNextValidators([validator], ['500'])
      expect((await validator.getInfo()).active).to.be.true

      // from attacker
      let tx = validator.deactivateValidator([await getEpoch(1)], attacker)
      await expect(tx).to.revertedWith('you are not owner or operator.')

      tx = validator.activateValidator([await getEpoch(1)], attacker)
      await expect(tx).to.revertedWith('you are not owner or operator.')
    })

    it('updateCommissionRate()', async () => {
      await allowAddress(validator)
      await validator.joinValidator()
      await staker1.stake(Token.OAS, validator, '1000')

      // from owner
      expect((await validator.getInfo()).commissionRate).to.equal(0)
      await validator.updateCommissionRate(10, owner)
      expect((await validator.getInfo()).commissionRate).to.equal(0)
      await toNextEpoch()
      expect((await validator.getInfo()).commissionRate).to.equal(10)

      // from operator
      let tx = validator.updateCommissionRate(10, operator)
      await expect(tx).to.revertedWith('validator does not exist.')

      // from attacker
      tx = validator.updateCommissionRate(10, attacker)
      await expect(tx).to.revertedWith('validator does not exist.')
    })

    it('claimCommissions()', async () => {
      await allowAddress(validator)
      await validator.joinValidator()
      await validator.updateCommissionRate(50)

      await staker1.stake(Token.OAS, validator, '500')
      await staker1.stake(Token.wOAS, validator, '250')
      await staker1.stake(Token.sOAS, validator, '250')

      await expectBalance(stakeManager, '500', '250', '250')
      await expectBalance(validator.owner, '10000', '0', '0')

      await toNextEpoch()
      await toNextEpoch()

      // from owner
      await validator.claimCommissions(owner)
      await expectBalance(stakeManager, '499.994292237442922375', '250', '250')
      await expectBalance(validator.owner, '10000.005707762557077625', '0', '0')

      await toNextEpoch()
      await toNextEpoch()

      // from operator
      await validator.claimCommissions(operator)
      await expectBalance(stakeManager, '499.982876712328767125', '250', '250')
      await expectBalance(validator.owner, '10000.017123287671232875', '0', '0')

      // from attacker
      const tx = validator.claimCommissions(attacker)
      await expect(tx).to.revertedWith('you are not owner or operator.')
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

    it('unstake() and claimUnstakes()', async () => {
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
    })
  })

  describe('rewards and commissions', () => {
    beforeEach(async () => {
      await initialize()
      await updateEnvironment({
        startEpoch: (await environment.epoch()).toNumber() + 1,
        jailThreshold: 120,
      })
      await toNextEpoch()
    })

    it('when operating ratio is 100%', async () => {
      const startingEpoch = (await environment.epoch()).toNumber()

      await staker1.stake(Token.OAS, validator1, '1000')
      await staker2.stake(Token.OAS, validator1, '2000')
      await toNextEpoch()

      await staker1.claimRewards(validator1, 0)
      await staker2.claimRewards(validator1, 0)
      await validator1.claimCommissions()

      await toNextEpoch() // 1
      await validator1.updateCommissionRate(10)
      await staker1.stake(Token.wOAS, validator1, '500')
      await staker2.stake(Token.sOAS, validator1, '500')
      await toNextEpoch() // 2
      await toNextEpoch() // 3
      await toNextEpoch() // 4
      await validator1.updateCommissionRate(50)
      await staker1.stake(Token.wOAS, validator1, '250')
      await staker1.stake(Token.sOAS, validator1, '250')
      await staker2.stake(Token.wOAS, validator1, '250')
      await staker2.stake(Token.sOAS, validator1, '250')
      await toNextEpoch() // 5
      await toNextEpoch() // 6
      await toNextEpoch() // 7
      await validator1.updateCommissionRate(100)
      await toNextEpoch() // 8
      await toNextEpoch() // 9
      await staker1.unstake(Token.OAS, validator1, '500')
      await staker1.unstake(Token.wOAS, validator1, '500')
      await staker2.unstake(Token.OAS, validator1, '500')
      await staker2.unstake(Token.sOAS, validator1, '500')
      await validator1.updateCommissionRate(10)
      await updateEnvironment({ startEpoch: startingEpoch + 12, rewardRate: 50 })
      await toNextEpoch() // 10

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

      await staker1.claimRewards(validator1, 5)
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
      await validator1.updateCommissionRate(10)
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
      await validator1.updateCommissionRate(10)
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
      await validator1.updateCommissionRate(10)
      await toNextEpoch()

      await staker1.claimRewards(validator1, 0)
      await staker2.claimRewards(validator1, 0)
      await validator1.claimCommissions()

      const epoch = (await environment.epoch()).toNumber()
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
      const startingEpoch = (await environment.epoch()).toNumber()
      await updateEnvironment({
        startEpoch: startingEpoch + 1,
        jailThreshold: 50,
      })
      await toNextEpoch()

      await staker1.stake(Token.OAS, validator1, '500')
      await staker1.stake(Token.OAS, validator2, '500')
      await staker1.stake(Token.OAS, validator3, '500')

      await expectCurrentValidators([fixedValidator])
      await expectNextValidators([validator1, validator2, validator3, fixedValidator])

      await toNextEpoch()

      await expectCurrentValidators([validator1, validator2, validator3, fixedValidator])
      await expectNextValidators([validator1, validator2, validator3, fixedValidator])

      await slash(validator1, validator2, 49)

      await expectCurrentValidators([validator1, validator2, validator3, fixedValidator])
      await expectNextValidators([validator1, validator2, validator3, fixedValidator])

      await toNextEpoch()

      await expectCurrentValidators([validator1, validator2, validator3, fixedValidator])
      await expectNextValidators([validator1, validator2, validator3, fixedValidator])

      await slash(validator1, validator2, 50)

      await expectCurrentValidators([validator1, validator2, validator3, fixedValidator])
      await expectNextValidators([validator1, validator3, fixedValidator])

      await toNextEpoch()

      await expectCurrentValidators([validator1, validator3, fixedValidator])
      await expectNextValidators([validator1, validator3, fixedValidator])

      await toNextEpoch()

      await expectCurrentValidators([validator1, validator3, fixedValidator])
      await expectNextValidators([validator1, validator2, validator3, fixedValidator])

      await toNextEpoch()

      await expectCurrentValidators([validator1, validator2, validator3, fixedValidator])
      await expectNextValidators([validator1, validator2, validator3, fixedValidator])
    })
  })

  describe('view functions', () => {
    beforeEach(async () => {
      await initialize()
    })

    it('getCurrentValidators() and getNextValidators()', async () => {
      await expectCurrentValidators([], [])
      await expectNextValidators([fixedValidator], ['500'])

      await staker1.stake(Token.OAS, validator1, '501')
      await staker1.stake(Token.OAS, validator2, '499')
      await staker1.stake(Token.OAS, validator3, '502')

      await expectCurrentValidators([], [])
      await expectNextValidators([validator1, validator3, fixedValidator], ['501', '502', '500'])

      await toNextEpoch()

      await expectCurrentValidators([validator1, validator3, fixedValidator], ['501', '502', '500'])
      await expectNextValidators([validator1, validator3, fixedValidator], ['501', '502', '500'])
    })

    it('getValidators()', async () => {
      const actuals = await stakeManager.getValidators()
      expect(actuals).to.eql(validators.map((x) => x.owner.address))
    })

    it('getStakers()', async () => {
      const _expect = async (page: number, perPage: number, expectStakers: Staker[]) => {
        page = page > 0 ? page : 1
        perPage = perPage > 0 ? perPage : 50

        const actuals = await stakeManager.getStakers(page, perPage)
        expect(actuals.length).to.equal(perPage)

        const _expectStakers = [...expectStakers.map((x) => x.address)]
        if (page === 1) {
          _expectStakers.unshift(fixedValidator.owner.address)
        }

        expect(actuals.slice(0, _expectStakers.length)).to.eql(_expectStakers)
        expect(actuals.slice(_expectStakers.length, perPage)).to.eql(
          [...Array(perPage - _expectStakers.length).keys()].map((_) => zeroAddress),
        )
      }

      await staker1.stake(Token.OAS, validator1, '1')
      await staker2.stake(Token.OAS, validator2, '2')
      await staker3.stake(Token.OAS, validator3, '3')
      await staker4.stake(Token.OAS, validator4, '4')
      await toNextEpoch()

      await _expect(0, 0, [staker1, staker2, staker3, staker4])
      await _expect(1, 4, [staker1, staker2, staker3])
      await _expect(2, 4, [staker4])
    })

    it('getValidatorInfo()', async () => {
      const checker = async (
        active: boolean,
        jailed: boolean,
        stakes: string,
        commissionRate: string,
        epoch?: number,
      ) => {
        const acutal = await validator1.getInfo(epoch)
        if (!epoch) {
          expect(acutal.operator).to.equal(validator1.operator.address)
        }
        expect(acutal.active).to.equal(active)
        expect(acutal.jailed).to.equal(jailed)
        expect(fromWei(acutal.stakes.toString())).to.eql(stakes)
        expect(acutal.commissionRate).to.equal(commissionRate)
      }

      await checker(true, false, '0', '0') // epoch 1
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '0', '0', 2)
      await checker(true, false, '0', '0', 3)

      await validator1.updateCommissionRate(10)
      await staker1.stake(Token.OAS, validator1, '500')
      await staker2.stake(Token.OAS, validator1, '250')

      await checker(true, false, '0', '0') // epoch 1
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '750', '10', 2)
      await checker(true, false, '750', '10', 3)

      await toNextEpoch()

      await checker(true, false, '750', '10') // epoch 2
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '750', '10', 2)
      await checker(true, false, '750', '10', 3)
      await checker(true, false, '750', '10', 4)

      await validator1.updateCommissionRate(20)

      await checker(true, false, '750', '10') // epoch 2
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '750', '10', 2)
      await checker(true, false, '750', '20', 3)
      await checker(true, false, '750', '20', 4)

      await toNextEpoch()

      await checker(true, false, '750', '20') // epoch 3
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '750', '10', 2)
      await checker(true, false, '750', '20', 3)
      await checker(true, false, '750', '20', 4)
      await checker(true, false, '750', '20', 5)

      await staker1.unstake(Token.OAS, validator1, '200')
      await staker2.unstake(Token.OAS, validator1, '100')

      await checker(true, false, '750', '20') // epoch 3
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '750', '10', 2)
      await checker(true, false, '750', '20', 3)
      await checker(true, false, '450', '20', 4)
      await checker(true, false, '450', '20', 5)

      await toNextEpoch()

      await checker(true, false, '450', '20') // epoch 4
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '750', '10', 2)
      await checker(true, false, '750', '20', 3)
      await checker(true, false, '450', '20', 4)
      await checker(true, false, '450', '20', 5)
      await checker(true, false, '450', '20', 6)

      const epoch: number = (await environment.epoch()).toNumber()
      await validator1.deactivateValidator([epoch + 1, epoch + 2])

      await checker(true, false, '450', '20') // epoch 4
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '750', '10', 2)
      await checker(true, false, '750', '20', 3)
      await checker(true, false, '450', '20', 4)
      await checker(false, false, '450', '20', 5)
      await checker(false, false, '450', '20', 6)
      await checker(true, false, '450', '20', 7)

      await toNextEpoch()

      await checker(false, false, '450', '20') // epoch 5
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '750', '10', 2)
      await checker(true, false, '750', '20', 3)
      await checker(true, false, '450', '20', 4)
      await checker(false, false, '450', '20', 5)
      await checker(false, false, '450', '20', 6)
      await checker(true, false, '450', '20', 7)
      await checker(true, false, '450', '20', 8)
      await checker(true, false, '450', '20', 9)

      await slash(validator1, validator1, 50)

      await checker(false, false, '450', '20') // epoch 5
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '750', '10', 2)
      await checker(true, false, '750', '20', 3)
      await checker(true, false, '450', '20', 4)
      await checker(false, false, '450', '20', 5)
      await checker(false, true, '450', '20', 6)
      await checker(true, true, '450', '20', 7)
      await checker(true, false, '450', '20', 8)
      await checker(true, false, '450', '20', 9)

      await toNextEpoch()

      await checker(false, true, '450', '20') // epoch 6
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '750', '10', 2)
      await checker(true, false, '750', '20', 3)
      await checker(true, false, '450', '20', 4)
      await checker(false, false, '450', '20', 5)
      await checker(false, true, '450', '20', 6)
      await checker(true, true, '450', '20', 7)
      await checker(true, false, '450', '20', 8)
      await checker(true, false, '450', '20', 9)

      await toNextEpoch()

      await checker(true, true, '450', '20') // epoch 7
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '750', '10', 2)
      await checker(true, false, '750', '20', 3)
      await checker(true, false, '450', '20', 4)
      await checker(false, false, '450', '20', 5)
      await checker(false, true, '450', '20', 6)
      await checker(true, true, '450', '20', 7)
      await checker(true, false, '450', '20', 8)
      await checker(true, false, '450', '20', 9)

      await toNextEpoch()

      await checker(true, false, '450', '20') // epoch 8
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '750', '10', 2)
      await checker(true, false, '750', '20', 3)
      await checker(true, false, '450', '20', 4)
      await checker(false, false, '450', '20', 5)
      await checker(false, true, '450', '20', 6)
      await checker(true, true, '450', '20', 7)
      await checker(true, false, '450', '20', 8)
      await checker(true, false, '450', '20', 9)

      await toNextEpoch()

      await checker(true, false, '450', '20') // epoch 9
      await checker(true, false, '0', '0', 1)
      await checker(true, false, '750', '10', 2)
      await checker(true, false, '750', '20', 3)
      await checker(true, false, '450', '20', 4)
      await checker(false, false, '450', '20', 5)
      await checker(false, true, '450', '20', 6)
      await checker(true, true, '450', '20', 7)
      await checker(true, false, '450', '20', 8)
      await checker(true, false, '450', '20', 9)
    })

    it('getStakerInfo()', async () => {
      await staker1.stake(Token.OAS, validator1, '500')
      await staker1.stake(Token.OAS, validator2, '250')
      await toNextEpoch()

      await staker1.unstake(Token.OAS, validator2, '250')
      await toNextEpoch()

      const acutal = await staker1.getInfo(Token.OAS)
      expect(fromWei(acutal.stakes.toString())).to.eql('500')
      expect(fromWei(acutal.unstakes.toString())).to.equal('250')
    })

    it('getValidatorStakes()', async () => {
      await staker1.stake(Token.OAS, validator1, '10')
      await toNextEpoch()

      await staker2.stake(Token.OAS, validator1, '20')
      await toNextEpoch()

      await staker1.stake(Token.OAS, validator1, '30')
      await staker3.stake(Token.OAS, validator1, '30')
      await toNextEpoch()

      await staker4.stake(Token.OAS, validator1, '40')
      await staker5.stake(Token.OAS, validator1, '40')
      await staker6.stake(Token.OAS, validator1, '40')
      await toNextEpoch()

      await staker2.unstake(Token.OAS, validator1, '20')
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
        ['40', '20', '30', '40', '40', '40'],
      )
      await validator1.expectStakes(
        6,
        [staker1, staker2, staker3, staker4, staker5, staker6],
        ['40', '0', '30', '40', '40', '40'],
      )
      await validator1.expectStakes(
        0,
        [staker1, staker2, staker3, staker4, staker5, staker6],
        ['40', '0', '30', '40', '40', '40'],
      )

      // check pagination
      await validator1.expectStakes(0, [staker1, staker2], ['40', '0'], 1, 2)
      await validator1.expectStakes(0, [staker3, staker4], ['30', '40'], 2, 2)
      await validator1.expectStakes(0, [staker5, staker6], ['40', '40'], 3, 2)
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
        [
          ['10', '10', '0', '35', '0'],
          ['0', '10', '0', '15', '0'],
          ['0', '0', '0', '20', '0'],
        ],
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
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      await staker1.unstake(Token.OAS, validator1, '1')
      await staker1.unstake(Token.OAS, validator1, '1')
      await staker1.unstake(Token.wOAS, validator1, '1')
      await staker1.unstake(Token.sOAS, validator1, '1')
      await staker1.unstake(Token.OAS, validator2, '2')
      await staker1.unstake(Token.wOAS, validator2, '1')
      await staker1.unstake(Token.OAS, validator4, '3')
      await staker1.unstake(Token.sOAS, validator4, '1')

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['10', '10', '0', '35', '0'],
          ['0', '10', '0', '15', '0'],
          ['0', '0', '0', '20', '0'],
        ],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
        [
          ['2', '2', '0', '3', '0'],
          ['0', '1', '0', '0', '0'],
          ['0', '0', '0', '1', '0'],
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
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      await staker1.stake(Token.wOAS, validator1, '1')
      await staker1.stake(Token.sOAS, validator2, '2')
      await staker1.stake(Token.OAS, validator4, '3')
      await staker1.stake(Token.OAS, validator1, '10')
      await staker1.stake(Token.wOAS, validator2, '20')
      await staker1.stake(Token.sOAS, validator4, '30')
      await staker1.unstake(Token.OAS, validator1, '10')
      await staker1.unstake(Token.wOAS, validator2, '20')
      await staker1.unstake(Token.sOAS, validator4, '30')

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['8', '8', '0', '32', '0'],
          ['0', '9', '0', '15', '0'],
          ['0', '0', '0', '19', '0'],
        ],
        [
          ['0', '0', '0', '3', '0'],
          ['1', '0', '0', '0', '0'],
          ['0', '2', '0', '0', '0'],
        ],
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
          ['8', '8', '0', '35', '0'],
          ['1', '9', '0', '15', '0'],
          ['0', '2', '0', '19', '0'],
        ],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
      )

      await staker1.stake(Token.OAS, validator1, '10')
      await staker1.stake(Token.wOAS, validator2, '20')
      await staker1.stake(Token.sOAS, validator4, '30')

      await staker1.unstake(Token.OAS, validator1, '5')
      await staker1.unstake(Token.wOAS, validator2, '10')
      await staker1.unstake(Token.sOAS, validator4, '15')

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        [
          ['8', '8', '0', '35', '0'],
          ['1', '9', '0', '15', '0'],
          ['0', '2', '0', '19', '0'],
        ],
        [
          ['5', '0', '0', '0', '0'],
          ['0', '10', '0', '0', '0'],
          ['0', '0', '0', '15', '0'],
        ],
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
          ['13', '8', '0', '35', '0'],
          ['1', '19', '0', '15', '0'],
          ['0', '2', '0', '34', '0'],
        ],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
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
        [
          ['10', '10', '0', '35', '0'],
          ['0', '10', '0', '15', '0'],
          ['0', '0', '0', '20', '0'],
        ],
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
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
        [
          ['2', '2', '0', '3', '0'],
          ['0', '1', '0', '0', '0'],
          ['0', '0', '0', '1', '0'],
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
        [
          ['0', '0', '0', '3', '0'],
          ['1', '0', '0', '0', '0'],
          ['0', '2', '0', '0', '0'],
        ],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
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
        [
          ['5', '0', '0', '0', '0'],
          ['0', '10', '0', '0', '0'],
          ['0', '0', '0', '15', '0'],
        ],
        [
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
          ['0', '0', '0', '0', '0'],
        ],
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

    it('getTotalRewards()', async () => {
      const checker = async (expectEther: string, epochs: number) => {
        let actual: BigNumber = await stakeManager.getTotalRewards(epochs)
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

      await staker1.unstake(Token.OAS, validator1, '250')
      await staker2.unstake(Token.OAS, validator2, '250')

      await toNextEpoch() // 5
      await toNextEpoch() // 6

      await checker('0.0456621', 1)
      await checker('0.0970319', 2)
      await checker('0.1484018', 3)
      await checker('0.1883561', 4)
      await checker('0.2283105', 5)
    })
  })
})
