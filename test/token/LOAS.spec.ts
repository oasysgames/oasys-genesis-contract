import { ethers, network } from 'hardhat'
import { Contract } from 'ethers'
import { SignerWithAddress as Account } from '@nomiclabs/hardhat-ethers/signers'
import { toWei, fromWei } from 'web3-utils'
import { expect } from 'chai'

const getTimestamp = (dates: string): number => {
  const date = new Date(dates)
  return date.getTime() / 1000
}

const setBlockTimestamp = async (dates: string) => {
  await network.provider.send('evm_setNextBlockTimestamp', [getTimestamp(dates)])
}

describe('LOAS', () => {
  let loas: Contract
  let genesis: Account
  let originalClaimer: Account
  let allowedClaimer: Account
  let invalidClaimer: Account

  before(async () => {
    const accounts = await ethers.getSigners()
    genesis = accounts[1]
    originalClaimer = accounts[2]
    allowedClaimer = accounts[3]
    invalidClaimer = accounts[4]
  })

  beforeEach(async () => {
    await network.provider.send('hardhat_reset')
    loas = await (await ethers.getContractFactory('LOAS')).deploy()
  })

  describe('revoke()', async () => {
    const expectBalance = async (user: Account, expOAS: number, expLOAS: number) => {
      const actualOAS = fromWei((await user.getBalance()).toString())
      const actualLOAS = fromWei((await loas.balanceOf(user.address)).toString())
      expect(actualOAS).to.match(new RegExp(`^${expOAS + 10000}`))
      expect(actualLOAS).to.match(new RegExp(`^${expLOAS}`))
    }
    const expectTotalSupply = async (exp: number) => {
      const actual = fromWei((await loas.totalSupply()).toString())
      expect(actual).to.match(new RegExp(`^${exp}`))
    }

    it('revoke all', async () => {
      // initial balance.
      await expectBalance(genesis, 0, 0)
      await expectBalance(originalClaimer, 0, 0)
      await expectTotalSupply(0)

      // minting.
      await setBlockTimestamp('2100/01/01')
      await loas
        .connect(genesis)
        .mint(originalClaimer.address, getTimestamp('2100/07/01'), getTimestamp('2100/12/31'), {
          value: toWei('100'),
        })

      // after minted.
      await expectBalance(originalClaimer, 0, 100)
      await expectTotalSupply(100)

      // 1 month elapsed.
      await setBlockTimestamp('2100/07/31')
      await loas.connect(originalClaimer).claim(toWei('16'))
      await expectBalance(originalClaimer, 16, 84)
      await expectTotalSupply(84)

      // Fail by non-existing holder
      let tx = loas.connect(originalClaimer).revoke(invalidClaimer.address, toWei('84'))
      await expect(tx).to.revertedWith('NotFound()')

      // Fail by invalid revoker.
      tx = loas.connect(originalClaimer).revoke(originalClaimer.address, toWei('84'))
      await expect(tx).to.revertedWith('InvalidRevoker()')

      // Revoke all.
      await expect(await loas.connect(genesis).revoke(originalClaimer.address, toWei('84')))
        .to.emit(loas, 'Revoke')
        .withArgs(originalClaimer.address, originalClaimer.address, toWei('84'))
      await expectBalance(genesis, -16, 0)
      await expectTotalSupply(0)
    })

    it('revoke locked only', async () => {
      // minting.
      await setBlockTimestamp('2100/01/01')
      await loas
        .connect(genesis)
        .mint(originalClaimer.address, getTimestamp('2100/07/01'), getTimestamp('2100/12/31'), {
          value: toWei('100'),
        })

      // after minted.
      await expectBalance(originalClaimer, 0, 100)
      await expectTotalSupply(100)

      // 1 month elapsed.
      await setBlockTimestamp('2100/07/31')

      // Revoke locked only.
      await loas.connect(genesis).revoke(originalClaimer.address, 0)
      let actualOAS = fromWei((await genesis.getBalance()).toString())
      expect(Math.ceil(Number(actualOAS))).to.equal(10000-100+84)
      let supply = fromWei((await loas.totalSupply()).toString())
      expect(Math.ceil(Number(supply))).to.equal(17)

      // Claim.
      await loas.connect(originalClaimer).claim(toWei('16'))
      await expectBalance(originalClaimer, 16, 0)
      supply = fromWei((await loas.totalSupply()).toString())
      expect(Math.ceil(Number(supply))).to.equal(1) // left less than 1 OAS.

      // 2 month elapsed.
      await setBlockTimestamp('2100/08/31')

      // Claim left.
      const left = await loas.balanceOf(originalClaimer.address)
      await loas.connect(originalClaimer).claim(left)
      supply = fromWei((await loas.totalSupply()).toString())
      expect(Math.ceil(Number(supply))).to.equal(0)
    })

    it('revoke splited LOAS', async () => {
      await setBlockTimestamp('2100/01/01')
      await loas
        .connect(genesis)
        .mint(originalClaimer.address, getTimestamp('2100/07/01'), getTimestamp('2100/12/31'), {
          value: toWei('100', 'ether'),
        })

      await expectBalance(allowedClaimer, 0, 0)

      // 2 month elapsed.
      await setBlockTimestamp('2100/08/31')

      // transfer.
      await loas.connect(genesis)['allow(address,address)'](originalClaimer.address, allowedClaimer.address)
      await loas.connect(originalClaimer)['transfer(address,uint256)'](allowedClaimer.address, toWei('50'))
      await expectBalance(originalClaimer, 0, 50)
      await expectBalance(allowedClaimer, 0, 50)
      await expectTotalSupply(100)

      // try to revoke original claimer, but it should fail as the locked LOAS is over than original claimer's balance.
      const tx = loas.connect(genesis).revoke(originalClaimer.address, 0)
      await expect(tx).to.revertedWith('OverAmount()')

      // revoke all the original claimer's balance.
      await loas.connect(genesis).revoke(originalClaimer.address, toWei('50'))
      await expectBalance(originalClaimer, 0, 0)
      await expectBalance(genesis, -50, 0)
      await expectTotalSupply(50)

      // revoke only locked LOAS from allowed claimer.
      await loas.connect(genesis).revoke(allowedClaimer.address, 0)
      let actualOAS = fromWei((await genesis.getBalance()).toString())
      expect(Math.ceil(Number(actualOAS))).to.equal(10000-100+50+17)
      let supply = fromWei((await loas.totalSupply()).toString())
      expect(Math.ceil(Number(supply))).to.equal(34)
      const clainInfo = await loas.claimInfo(originalClaimer.address)
      expect(Math.ceil(Number(fromWei((clainInfo.revoked).toString())))).to.equal(50+17)

      // claim all the left amount
      const left = await loas.balanceOf(allowedClaimer.address)
      await loas.connect(allowedClaimer).claim(left)
      supply = fromWei((await loas.totalSupply()).toString())
      expect(Math.ceil(Number(supply))).to.equal(0)
    })
  })
})
