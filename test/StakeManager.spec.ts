import { ethers, network } from 'hardhat'
import { Contract, BigNumber } from 'ethers'
import { SignerWithAddress as Account } from '@nomiclabs/hardhat-ethers/signers'
import { toWei, fromWei } from 'web3-utils'
import { expect } from 'chai'

import { EnvironmentValue, Validator, Staker, mining, zeroAddress } from './helpers'

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

  let currentBlock = 0

  const expectCurrentValidators = async (expectValidators: Validator[], expectStakes?: string[]) => {
    const { owners, operators, stakes } = await stakeManager.getCurrentValidators()
    expect(owners).to.eql(expectValidators.map((x) => x.owner.address))
    expect(operators).to.eql(expectValidators.map((x) => x.operator.address))
    if (expectStakes) {
      expect(stakes.map((x: any) => fromWei(x.toString()))).to.eql(expectStakes)
    }
  }

  const expectContractBalance = async (expectEther: string) => {
    const actual = await stakeManager.provider.getBalance(stakeManager.address)
    expect(fromWei(actual.toString())).to.equal(expectEther)
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
    await fixedValidator.stake(fixedValidator, '500')
  }

  const initialize = async () => {
    await initializeContracts()
    await initializeValidators()
  }

  const toNextEpoch = async (validator?: Validator) => {
    currentBlock += initialEnv.epochPeriod

    // updateValidators()
    await mining(currentBlock - 2)
    await stakeManager.connect(validator?.operator ?? fixedValidator.operator).updateValidators()

    // updateValidatorBlocks()
    const { operators } = await stakeManager.getCurrentValidators()
    const blocks: number[] = operators.map((_: any) => ~~(initialEnv.epochPeriod / operators.length))
    await stakeManager.connect(validator?.operator ?? fixedValidator.operator).updateValidatorBlocks(operators, blocks)

    await mining(currentBlock)
  }

  before(async () => {
    accounts = await ethers.getSigners()
    deployer = accounts[0]
  })

  beforeEach(async () => {
    await network.provider.send('hardhat_reset')

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
      await allowAddress(validator)
      await validator.joinValidator()

      // from owner
      await validator.deactivateValidator(owner)
      expect((await validator.getInfo()).active).to.be.false

      await validator.activateValidator(owner)
      expect((await validator.getInfo()).active).to.be.true

      // from operator
      await validator.deactivateValidator(operator)
      expect((await validator.getInfo()).active).to.be.false

      await validator.activateValidator(operator)
      expect((await validator.getInfo()).active).to.be.true

      // from attacker
      let tx = validator.deactivateValidator(attacker)
      await expect(tx).to.revertedWith('you are not owner or operator.')

      tx = validator.activateValidator(attacker)
      await expect(tx).to.revertedWith('you are not owner or operator.')
    })

    it('updateCommissionRate()', async () => {
      await allowAddress(validator)
      await validator.joinValidator()
      await staker1.stake(validator, '1000')

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
      await staker1.stake(validator, '1000')

      await toNextEpoch()
      await toNextEpoch()

      // from owner
      await validator.claimCommissions(owner)
      await validator.expectBalance('10000.005707762557077625')
      await expectContractBalance('999.994292237442922375')

      await toNextEpoch()
      await toNextEpoch()

      // from operator
      await validator.claimCommissions(operator)
      await validator.expectBalance('10000.017123287671232875')
      await expectContractBalance('999.982876712328767125')

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
      await staker1.expectTotalStake('0')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['0', '0', '0', '0', '0'],
      )

      await staker1.stake(validator1, '10')

      await staker1.expectTotalStake('0')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['0', '0', '0', '0', '0'],
      )

      await toNextEpoch()

      await staker1.expectTotalStake('10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['10', '0', '0', '0', '0'],
      )

      await staker1.stake(validator1, '20')
      await staker1.stake(validator1, '30')

      await staker1.expectTotalStake('10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['10', '0', '0', '0', '0'],
      )

      await toNextEpoch()

      await staker1.expectTotalStake('60')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['60', '0', '0', '0', '0'],
      )

      await staker1.stake(validator1, '40')
      await staker1.stake(validator2, '40')

      await staker1.expectTotalStake('60')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['60', '0', '0', '0', '0'],
      )

      await toNextEpoch()

      await staker1.expectTotalStake('140')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['100', '40', '0', '0', '0'],
      )

      await expectContractBalance('640')
    })

    it('unstake()', async () => {
      await staker1.stake(validator1, '10')
      await staker1.stake(validator2, '20')
      await expectContractBalance('530')

      await toNextEpoch()

      await staker1.expectTotalStake('30')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['10', '20', '0', '0', '0'],
      )

      await staker1.unstake(validator1, '5')

      await staker1.expectTotalStake('30')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['10', '20', '0', '0', '0'],
      )
      await expectContractBalance('530')

      await toNextEpoch()

      await staker1.expectTotalStake('25')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['5', '20', '0', '0', '0'],
      )

      await staker1.unstake(validator1, '1')
      await staker1.unstake(validator1, '2')

      await staker1.expectTotalStake('25')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['5', '20', '0', '0', '0'],
      )
      await expectContractBalance('530')

      await toNextEpoch()

      await staker1.expectTotalStake('22')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['2', '20', '0', '0', '0'],
      )

      await staker1.unstake(validator1, '9999')
      await staker1.unstake(validator2, '10')

      await staker1.expectTotalStake('22')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['2', '20', '0', '0', '0'],
      )
      await expectContractBalance('530')

      await toNextEpoch()

      await staker1.expectTotalStake('10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['0', '10', '0', '0', '0'],
      )

      // testing for immediate refunds
      await staker1.expectBalance('9970')

      await staker1.claimUnstakes()

      await staker1.expectBalance('9990')
      await staker1.expectTotalStake('10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['0', '10', '0', '0', '0'],
      )
      await expectContractBalance('510')

      await staker1.stake(validator2, '5')

      await staker1.expectBalance('9985')
      await staker1.expectTotalStake('10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['0', '10', '0', '0', '0'],
      )
      await expectContractBalance('515')

      await staker1.unstake(validator2, '10')

      await staker1.expectBalance('9990')
      await staker1.expectTotalStake('10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['0', '10', '0', '0', '0'],
      )
      await expectContractBalance('510')

      await toNextEpoch()

      await staker1.claimUnstakes()

      await staker1.expectBalance('9995')
      await staker1.expectTotalStake('5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['0', '5', '0', '0', '0'],
      )
      await expectContractBalance('505')

      await staker1.stake(validator2, '10')

      await staker1.expectBalance('9985')
      await staker1.expectTotalStake('5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['0', '5', '0', '0', '0'],
      )
      await expectContractBalance('515')

      await staker1.unstake(validator2, '5')

      await staker1.expectBalance('9990')
      await staker1.expectTotalStake('5')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['0', '5', '0', '0', '0'],
      )
      await expectContractBalance('510')

      await toNextEpoch()

      await staker1.claimUnstakes()

      await staker1.expectBalance('9990')
      await staker1.expectTotalStake('10')
      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['0', '10', '0', '0', '0'],
      )
      await expectContractBalance('510')
    })

    it('claimUnstakes()', async () => {
      await staker1.stake(validator1, '10')

      await toNextEpoch()

      await staker1.expectBalance('9990')
      await expectContractBalance('510')

      await staker1.unstake(validator1, '5')

      // cannot be claim until the next epoch
      await staker1.claimUnstakes()
      await staker1.expectBalance('9990')
      await expectContractBalance('510')

      await toNextEpoch()

      await staker1.claimUnstakes()

      await expectContractBalance('505')
      await staker1.expectBalance('9995')

      // check for double claim
      await staker1.claimUnstakes()
      await staker1.expectBalance('9995')
      await expectContractBalance('505')

      await staker1.unstake(validator1, '5')
      await toNextEpoch()
      await toNextEpoch()
      await toNextEpoch()

      await staker1.claimUnstakes()
      await staker1.expectBalance('10000')
      await expectContractBalance('500')

      // check for double claim
      await staker1.claimUnstakes()
      await staker1.expectBalance('10000')
      await expectContractBalance('500')
    })
  })

  describe('rewards and commissions', () => {
    beforeEach(async () => {
      await initialize()
      await environment.connect(fixedValidator.operator).updateValue({
        ...(await environment.value()),
        startEpoch: (await environment.epoch()).toNumber() + 1,
        jailThreshold: 500,
      })
      await toNextEpoch()
    })

    it('when operating ratio is 100%', async () => {
      const startingEpoch = (await environment.epoch()).toNumber()

      await staker1.stake(validator1, '1000')
      await staker2.stake(validator1, '2000')
      await toNextEpoch()

      await staker1.claimRewards(validator1, 0)
      await staker2.claimRewards(validator1, 0)
      await validator1.claimCommissions()

      await toNextEpoch() // 1
      await validator1.updateCommissionRate(10)
      await staker1.stake(validator1, '500')
      await staker2.stake(validator1, '500')
      await toNextEpoch() // 2
      await toNextEpoch() // 3
      await toNextEpoch() // 4
      await validator1.updateCommissionRate(50)
      await staker1.stake(validator1, '500')
      await staker2.stake(validator1, '500')
      await toNextEpoch() // 5
      await toNextEpoch() // 6
      await toNextEpoch() // 7
      await validator1.updateCommissionRate(100)
      await toNextEpoch() // 8
      await toNextEpoch() // 9
      await staker1.unstake(validator1, '1000')
      await staker2.unstake(validator1, '1000')
      await validator1.updateCommissionRate(10)
      await environment.connect(fixedValidator.operator).updateValue({
        ...(await environment.value()),
        startEpoch: startingEpoch + 12,
        rewardRate: 50,
      })
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
        await staker1.expectBalance('8000.06906392')
        await staker2.expectBalance('7000.12271689')
        await validator1.expectBalance('10000.01369863')

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

        await staker1.expectBalance('8000.21632420')
        await staker2.expectBalance('7000.40011415')
        await validator1.expectBalance('10000.25114155')

        await staker1.expectRewards('0', validator1, 0)
        await staker2.expectRewards('0', validator1, 0)
        await validator1.expectCommissions('0', 0)
      }

      await check2()

      // check for double claim
      await check2()
    })

    it('when operating ratio is 50%', async () => {
      await staker1.stake(validator1, '1000')
      await staker2.stake(validator1, '2000')
      await validator1.updateCommissionRate(10)
      await toNextEpoch()

      await staker1.claimRewards(validator1, 0)
      await staker2.claimRewards(validator1, 0)
      await validator1.claimCommissions()

      await toNextEpoch() // 1
      await Promise.all([...Array(60).keys()].map((_) => validator1.slash(validator1)))
      await toNextEpoch() // 2
      await toNextEpoch() // 3
      await Promise.all([...Array(60).keys()].map((_) => validator1.slash(validator1)))
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

    it('when operating ratio is 0%', async () => {
      await staker1.stake(validator1, '1000')
      await staker2.stake(validator1, '2000')
      await validator1.updateCommissionRate(10)
      await toNextEpoch()

      await staker1.claimRewards(validator1, 0)
      await staker2.claimRewards(validator1, 0)
      await validator1.claimCommissions()

      await toNextEpoch() // 1
      await Promise.all([...Array(120).keys()].map((_) => validator1.slash(validator1)))
      await toNextEpoch() // 2
      await toNextEpoch() // 3
      await Promise.all([...Array(120).keys()].map((_) => validator1.slash(validator1)))
      await toNextEpoch() // 4

      await staker1.expectRewards('0.01027397', validator1, 1)
      await staker2.expectRewards('0.02054794', validator1, 1)
      await validator1.expectCommissions('0.00342465', 1)

      await staker1.expectRewards('0.01027397', validator1, 2)
      await staker2.expectRewards('0.02054794', validator1, 2)
      await validator1.expectCommissions('0.00342465', 2)

      await staker1.expectRewards('0.02054794', validator1, 3)
      await staker2.expectRewards('0.04109589', validator1, 3)
      await validator1.expectCommissions('0.00684931', 3)

      await staker1.expectRewards('0.02054794', validator1, 4)
      await staker2.expectRewards('0.04109589', validator1, 4)
      await validator1.expectCommissions('0.00684931', 3)
    })
  })

  describe('current validator functions', () => {
    beforeEach(async () => {
      await initialize()
    })

    it('slash()', async () => {
      const startingEpoch = (await environment.epoch()).toNumber()
      await environment.connect(fixedValidator.operator).updateValue({
        ...(await environment.value()),
        startEpoch: startingEpoch + 1,
        jailThreshold: 50,
      })
      await toNextEpoch()

      await staker1.stake(validator1, '500')
      await staker1.stake(validator2, '500')
      await staker1.stake(validator3, '500')
      await expectCurrentValidators([fixedValidator])

      await toNextEpoch()
      await expectCurrentValidators([validator1, validator2, validator3, fixedValidator])

      await Promise.all([...Array(49).keys()].map((_) => validator1.slash(validator2)))
      await toNextEpoch()
      await expectCurrentValidators([validator1, validator2, validator3, fixedValidator])

      await Promise.all([...Array(50).keys()].map((_) => validator1.slash(validator2)))
      await toNextEpoch()
      await expectCurrentValidators([validator1, validator3, fixedValidator])

      await toNextEpoch()
      await expectCurrentValidators([validator1, validator3, fixedValidator])

      await toNextEpoch()
      await expectCurrentValidators([validator1, validator2, validator3, fixedValidator])
    })

    it('updateValidators()', async () => {
      await staker1.stake(validator1, '501')
      await staker2.stake(validator2, '250')
      await staker3.stake(validator2, '250')
      await staker3.stake(validator3, '499.999')
      await staker4.stake(validator4, '502')
      await toNextEpoch(fixedValidator)
      await expectCurrentValidators([validator1, validator2, validator4, fixedValidator])

      await staker3.stake(validator3, '10')
      await toNextEpoch(fixedValidator)
      await expectCurrentValidators([validator1, validator2, validator3, validator4, fixedValidator])

      await staker3.unstake(validator3, '10')
      await toNextEpoch(fixedValidator)
      await expectCurrentValidators([validator1, validator2, validator4, fixedValidator])
    })
  })

  describe('view functions', () => {
    beforeEach(async () => {
      await initialize()
    })

    it('getCurrentValidators()', async () => {
      await staker1.stake(validator1, '501')
      await staker1.stake(validator2, '499')
      await staker1.stake(validator3, '502')
      await toNextEpoch()

      await expectCurrentValidators([validator1, validator3, fixedValidator], ['501', '502', '500'])
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

      await staker1.stake(validator1, '1')
      await staker2.stake(validator2, '2')
      await staker3.stake(validator3, '3')
      await staker4.stake(validator4, '4')
      await toNextEpoch()

      await _expect(0, 0, [staker1, staker2, staker3, staker4])
      await _expect(1, 4, [staker1, staker2, staker3])
      await _expect(2, 4, [staker4])
    })

    it('getValidatorInfo()', async () => {
      await validator1.updateCommissionRate(10)
      await staker1.stake(validator1, '500')
      await staker2.stake(validator1, '250')
      await toNextEpoch()

      await Promise.all([...Array(50).keys()].map((_) => validator1.slash(validator1)))
      await toNextEpoch()

      const acutal = await validator1.getInfo()
      expect(acutal.operator).to.equal(validator1.operator.address)
      expect(acutal.active).to.be.true
      expect(fromWei(acutal.stakes.toString())).to.eql('750')
      expect(acutal.commissionRate).to.equal('10')
      expect(acutal.jailEpoch.toString()).to.eql('2')
    })

    it('getStakerInfo()', async () => {
      await staker1.stake(validator1, '500')
      await staker1.stake(validator2, '250')
      await toNextEpoch()

      await staker1.unstake(validator2, '250')
      await toNextEpoch()

      const acutal = await staker1.getInfo()
      expect(fromWei(acutal.stakes.toString())).to.eql('500')
      expect(fromWei(acutal.unstakes.toString())).to.equal('250')
    })

    it('getValidatorStakes()', async () => {
      await staker1.stake(validator1, '10')
      await toNextEpoch()

      await staker2.stake(validator1, '20')
      await toNextEpoch()

      await staker1.stake(validator1, '30')
      await staker3.stake(validator1, '30')
      await toNextEpoch()

      await staker4.stake(validator1, '40')
      await staker5.stake(validator1, '40')
      await staker6.stake(validator1, '40')
      await toNextEpoch()

      await staker2.unstake(validator1, '20')
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
      await staker1.stake(validator1, '10')
      await staker1.stake(validator2, '20')
      await staker1.stake(validator4, '30')
      await staker1.stake(validator4, '40')

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['0', '0', '0', '0', '0'],
        ['10', '20', '0', '70', '0'],
        ['0', '0', '0', '0', '0'],
      )

      await toNextEpoch()

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['10', '20', '0', '70', '0'],
        ['0', '0', '0', '0', '0'],
        ['0', '0', '0', '0', '0'],
      )

      await staker1.unstake(validator1, '1')
      await staker1.unstake(validator2, '2')
      await staker1.unstake(validator4, '3')
      await staker1.unstake(validator4, '4')

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['10', '20', '0', '70', '0'],
        ['0', '0', '0', '0', '0'],
        ['1', '2', '0', '7', '0'],
      )

      await toNextEpoch()

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['9', '18', '0', '63', '0'],
        ['0', '0', '0', '0', '0'],
        ['0', '0', '0', '0', '0'],
      )

      await staker1.stake(validator1, '2')
      await staker1.stake(validator2, '4')
      await staker1.stake(validator4, '6')
      await staker1.stake(validator4, '7')

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['9', '18', '0', '63', '0'],
        ['2', '4', '0', '13', '0'],
        ['0', '0', '0', '0', '0'],
      )

      await toNextEpoch()

      await staker1.expectStakes(
        0,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['11', '22', '0', '76', '0'],
        ['0', '0', '0', '0', '0'],
        ['0', '0', '0', '0', '0'],
      )

      await staker1.expectStakes(
        1,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['0', '0', '0', '0', '0'],
        ['10', '20', '0', '70', '0'],
        ['0', '0', '0', '0', '0'],
      )

      await staker1.expectStakes(
        2,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['10', '20', '0', '70', '0'],
        ['0', '0', '0', '0', '0'],
        ['1', '2', '0', '7', '0'],
      )

      await staker1.expectStakes(
        3,
        [validator1, validator2, validator3, validator4, fixedValidator],
        ['9', '18', '0', '63', '0'],
        ['2', '4', '0', '13', '0'],
        ['0', '0', '0', '0', '0'],
      )
    })

    it('getBlockAndSlashes()', async () => {
      await staker1.stake(validator1, '500')
      await staker1.stake(validator2, '500')

      await toNextEpoch()
      await toNextEpoch()

      await Promise.all([...Array(10).keys()].map((_) => validator1.slash(validator2)))

      await toNextEpoch()
      await toNextEpoch()
      await toNextEpoch()

      await Promise.all([...Array(20).keys()].map((_) => validator1.slash(validator2)))

      await toNextEpoch()

      await validator2.expectSlashes(1, 0, 0)
      await validator2.expectSlashes(2, 80, 0)
      await validator2.expectSlashes(3, 80, 10)
      await validator2.expectSlashes(4, 80, 0)
      await validator2.expectSlashes(5, 80, 0)
      await validator2.expectSlashes(6, 80, 20)
      await validator2.expectSlashes(7, 80, 0) // current epoch
    })

    it('getTotalRewards()', async () => {
      const checker = async (expectEther: string, epochs: number) => {
        let actual: BigNumber = await stakeManager.getTotalRewards(epochs)
        expect(fromWei(actual.toString())).to.match(new RegExp(`^${expectEther}`))
      }

      await staker1.stake(validator1, '1000')
      await staker2.stake(validator2, '2000')
      await toNextEpoch()

      await toNextEpoch() // 1

      await staker1.stake(validator1, '500')
      await staker2.stake(validator2, '500')

      await toNextEpoch() // 3
      await toNextEpoch() // 4

      await staker1.unstake(validator1, '250')
      await staker2.unstake(validator2, '250')

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
