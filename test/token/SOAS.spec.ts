import { ethers, network } from 'hardhat'
import { Contract } from 'ethers'
import { SignerWithAddress as Account } from '@nomiclabs/hardhat-ethers/signers'
import { toWei, fromWei } from 'web3-utils'
import { expect } from 'chai'

import { zeroAddress } from '../helpers'

const getTimestamp = (dates: string): number => {
  const date = new Date(dates)
  return date.getTime() / 1000
}

const setBlockTimestamp = async (dates: string) => {
  await network.provider.send('evm_setNextBlockTimestamp', [getTimestamp(dates)])
}

describe('SOAS', () => {
  let soas: Contract
  let genesis: Account
  let originalClaimer: Account
  let allowedClaimer: Account

  before(async () => {
    const accounts = await ethers.getSigners()
    genesis = accounts[1]
    originalClaimer = accounts[2]
    allowedClaimer = accounts[3]
  })

  beforeEach(async () => {
    await network.provider.send('hardhat_reset')
    soas = await (await ethers.getContractFactory('SOAS')).deploy([zeroAddress, zeroAddress])
  })

  describe('claim()', async () => {
    const expectBalance = async (user: Account, expOAS: number, expSOAS: number) => {
      const actualOAS = fromWei((await user.getBalance()).toString())
      const actualSOAS = fromWei((await soas.balanceOf(user.address)).toString())
      expect(actualOAS).to.match(new RegExp(`^${expOAS + 10000}`))
      expect(actualSOAS).to.match(new RegExp(`^${expSOAS}`))
    }
    const expectClaimableOAS = async (original: Account, exp: number) => {
      const actual = fromWei((await soas.getClaimableOAS(original.address)).toString())
      expect(actual).to.match(new RegExp(`^${exp}`))
    }
    const expectTotalSupply = async (exp: number) => {
      const actual = fromWei((await soas.totalSupply()).toString())
      expect(actual).to.match(new RegExp(`^${exp}`))
    }

    it('claim from original claimer', async () => {
      // initial balance.
      await expectBalance(originalClaimer, 0, 0)
      await expectTotalSupply(0)

      // minting.
      await setBlockTimestamp('2100/01/01')
      await soas
        .connect(genesis)
        .mint(originalClaimer.address, getTimestamp('2100/07/01'), getTimestamp('2100/12/31'), {
          value: toWei('100'),
        })

      // after minted.
      await expectBalance(originalClaimer, 0, 100)
      await expectTotalSupply(100)

      // 1 month elapsed.
      await setBlockTimestamp('2100/07/31')
      await soas.connect(originalClaimer).claim(toWei('16'))
      await expectBalance(originalClaimer, 16, 84)
      await expectTotalSupply(84)

      // 2 month elapsed.
      await setBlockTimestamp('2100/08/31')
      await soas.connect(originalClaimer).claim(toWei('16'))
      await expectBalance(originalClaimer, 32, 68)
      await expectTotalSupply(68)

      // 3 month elapsed.
      await setBlockTimestamp('2100/09/31')
      await soas.connect(originalClaimer).claim(toWei('16', 'ether'))
      await expectBalance(originalClaimer, 48, 52)
      await expectTotalSupply(52)

      // 4 month elapsed.
      await setBlockTimestamp('2100/10/31')
      await soas.connect(originalClaimer).claim(toWei('16', 'ether'))
      await expectBalance(originalClaimer, 64, 36)
      await expectTotalSupply(36)

      // 5 month elapsed.
      await setBlockTimestamp('2100/11/31')
      await soas.connect(originalClaimer).claim(toWei('16', 'ether'))
      await expectBalance(originalClaimer, 80, 20)
      await expectTotalSupply(20)

      // 6 month elapsed.
      await setBlockTimestamp('2100/12/31')
      await soas.connect(originalClaimer).claim(toWei('20', 'ether'))
      await expectBalance(originalClaimer, 100, 0)
      await expectTotalSupply(0)

      // insufficient balance.
      await setBlockTimestamp('2101/01/01')
      await expect(soas.connect(originalClaimer).claim(toWei('0.00001', 'ether'))).to.revertedWith('OverAmount()')
    })

    it('claim from allowed claimer', async () => {
      await setBlockTimestamp('2100/01/01')
      await soas
        .connect(genesis)
        .mint(originalClaimer.address, getTimestamp('2100/07/01'), getTimestamp('2100/12/31'), {
          value: toWei('100', 'ether'),
        })

      await expectBalance(originalClaimer, 0, 100)
      await expectBalance(allowedClaimer, 0, 0)
      await expectClaimableOAS(originalClaimer, 0)
      await expectClaimableOAS(allowedClaimer, 0)
      await expectTotalSupply(100)

      await setBlockTimestamp('2100/08/31')

      // claim from original claimer.
      await soas.connect(originalClaimer).claim(toWei('5'))
      await expectBalance(originalClaimer, 5, 95)
      await expectBalance(allowedClaimer, 0, 0)
      await expectTotalSupply(95)

      // transfer.
      await soas.connect(genesis).allow(originalClaimer.address, allowedClaimer.address)
      await soas.connect(originalClaimer).transfer(allowedClaimer.address, toWei('10'))
      await expectBalance(originalClaimer, 5, 85)
      await expectBalance(allowedClaimer, 0, 10)
      await expectTotalSupply(95)

      // claim from allowed claimer.
      await soas.connect(allowedClaimer).claim(toWei('5'))
      await expectBalance(originalClaimer, 5, 85)
      await expectBalance(allowedClaimer, 5, 5)
      await expectTotalSupply(90)

      await soas.connect(allowedClaimer).claim(toWei('5'))
      await expectBalance(originalClaimer, 5, 85)
      await expectBalance(allowedClaimer, 10, 0)
      await expectTotalSupply(85)

      await soas.connect(originalClaimer).claim(toWei('18'))
      await expectBalance(originalClaimer, 5 + 18, 85 - 18)
      await expectBalance(allowedClaimer, 10, 0)
      await expectTotalSupply(85 - 18)
    })
  })
})
