import { ethers, network } from 'hardhat'
import { Contract, BigNumber } from 'ethers'
import { SignerWithAddress as Account } from '@nomiclabs/hardhat-ethers/signers'
import { toWei } from 'web3-utils'
import { expect } from 'chai'

import { mining, EnvironmentValue } from './helpers'

const initialValue: EnvironmentValue = {
  startBlock: 0,
  startEpoch: 0,
  blockPeriod: 10,
  epochPeriod: 100,
  rewardRate: 10,
  validatorThreshold: toWei('500', 'ether'),
  jailThreshold: 50,
  jailPeriod: 2,
}

const expectValues = (actual: EnvironmentValue, expect_: EnvironmentValue) => {
  expect(actual.blockPeriod).to.equal(expect_.blockPeriod)
  expect(actual.epochPeriod).to.equal(expect_.epochPeriod)
  expect(actual.rewardRate).to.equal(expect_.rewardRate)
  expect(actual.validatorThreshold).to.equal(expect_.validatorThreshold)
  expect(actual.jailThreshold).to.equal(expect_.jailThreshold)
  expect(actual.jailPeriod).to.equal(expect_.jailPeriod)
}

describe('Environment', () => {
  let accounts: Account[]
  let environment: Contract
  let currentBlock = 0

  const toNextEpoch = async () => {
    currentBlock += initialValue.epochPeriod
    await mining(currentBlock - 2)
    await mining(currentBlock)
  }

  const initialize = async () => {
    await environment.initialize(initialValue)
    await toNextEpoch()
  }

  before(async () => {
    accounts = await ethers.getSigners()
  })

  beforeEach(async () => {
    await network.provider.send('hardhat_reset')
    await network.provider.send('hardhat_setCoinbase', [accounts[0].address])
    environment = await (await ethers.getContractFactory('Environment')).deploy()
    currentBlock = 0
  })

  it('initialize()', async () => {
    await initialize()
    await expect(initialize()).to.revertedWith('already initialized.')
  })

  describe('updateValue()', async () => {
    it('startEpoch is past', async () => {
      await initialize()

      const tx = environment.updateValue(initialValue)
      await expect(tx).to.revertedWith('startEpoch must be future.')
    })
  })

  describe('epoch()', () => {
    const updateValue = async (startEpoch: number, epochPeriod: number) => {
      const value = { ...initialValue, startEpoch, epochPeriod }
      return await environment.updateValue(value)
    }

    const expectEpoch = async (start: number, end: number, expect_: number) => {
      for (let i = start; i <= end; i++) {
        await mining(i)
        expect(await environment.epoch()).to.equal(expect_)
      }
    }

    beforeEach(async () => {
      await initialize()
    })

    it('simple case', async () => {
      await expectEpoch(100, 199, 2)

      await updateValue(4, 150)

      await expectEpoch(200, 299, 3)
      await expectEpoch(300, 449, 4)

      await updateValue(6, 50)

      await expectEpoch(450, 599, 5)
      await expectEpoch(600, 649, 6)
      await expectEpoch(650, 699, 7)
    })

    it('update in last block of epoch', async () => {
      await expectEpoch(100, 198, 2)
      await expect(updateValue(3, 150)).to.revertedWith('last block of epoch.')
    })

    it('update in first block of epoch', async () => {
      await expectEpoch(100, 199, 2)

      await updateValue(4, 150)

      await expectEpoch(200, 299, 3)
      await expectEpoch(300, 349, 4)
    })

    it('overwriting the same epoch', async () => {
      await expectEpoch(100, 199, 2)

      await updateValue(4, 150)

      await expectEpoch(200, 250, 3)

      await updateValue(4, 200)

      await expectEpoch(200, 299, 3)

      await expectEpoch(300, 499, 4)
      await expectEpoch(500, 699, 5)
    })

    it('overwriting the same epoch', async () => {
      await expectEpoch(100, 199, 2)

      await updateValue(4, 150)

      await expectEpoch(200, 250, 3)

      await updateValue(5, 200)

      await expectEpoch(250, 299, 3)

      await expectEpoch(300, 399, 4)
      await expectEpoch(400, 599, 5)
    })
  })

  it('value()', async () => {
    const miningAndExpect = async (start: number, end: number, expect_: EnvironmentValue) => {
      for (let i = start; i <= end; i++) {
        await mining(i)
        expectValues(await environment.value(), expect_)
      }
    }

    await initialize()

    let newValue1 = { ...initialValue }
    newValue1.startEpoch = 4
    newValue1.epochPeriod = 50
    newValue1.rewardRate += 1
    await environment.updateValue(newValue1)

    await miningAndExpect(0, 299, initialValue)

    const newValue2 = { ...newValue1 }
    newValue2.startEpoch = 6
    newValue2.rewardRate += 1
    await environment.updateValue(newValue2)

    await miningAndExpect(300, 399, newValue1)

    const newValue3 = { ...newValue1 }
    newValue3.startEpoch = 12
    newValue3.rewardRate += 1
    await environment.updateValue(newValue3)

    await miningAndExpect(400, 699, newValue2)
    await miningAndExpect(700, 710, newValue3)
  })

  it('epochAndValues()', async () => {
    const value1 = { ...initialValue, startEpoch: 4, rewardRate: 1 }
    const value2 = { ...initialValue, startEpoch: 7, rewardRate: 2 }
    const value3 = { ...initialValue, startEpoch: 10, rewardRate: 3 }

    await initialize()

    await environment.updateValue(value1)
    await mining(300)

    await environment.updateValue(value2)
    await mining(700)

    await environment.updateValue(value3)
    await mining(1000)

    const { epochs, _values } = await environment.epochAndValues()
    expect(epochs.map((x: BigNumber) => x.toNumber())).to.eql([1, 4, 7, 10])
    expect(_values.length).to.equal(4)
    expectValues(_values[0], initialValue)
    expectValues(_values[1], value1)
    expectValues(_values[2], value2)
    expectValues(_values[3], value3)
  })
})
