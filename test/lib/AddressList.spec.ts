import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { SignerWithAddress as Account } from '@nomiclabs/hardhat-ethers/signers'

import { ntoa, zeroAddress } from '../helpers'
import type { AddressList } from '../../typechain-types/contracts/lib'

describe('AddressList', function () {
  let owner: Account
  let outsider: Account
  let contract: AddressList

  const expectList = async (exp: string[]) => {
    const { addresses } = await contract.list(0, 100)
    expect(addresses).to.eql(exp)
  }

  beforeEach(async () => {
    ;[owner, outsider] = await ethers.getSigners()
  })

  beforeEach(async () => {
    const factory = await ethers.getContractFactory('AddressList')
    contract = await factory.connect(owner).deploy()
  })

  beforeEach(async () => {
    await contract.add(ntoa(10))
    await contract.add(ntoa(20))
    await contract.add(ntoa(30))
    await contract.add(ntoa(40))
    await contract.add(ntoa(50))
    await expectList([ntoa(10), ntoa(20), ntoa(30), ntoa(40), ntoa(50)])
  })

  describe('add()', () => {
    it('normally', async () => {
      await contract.add(ntoa(60))
      await expectList([ntoa(10), ntoa(20), ntoa(30), ntoa(40), ntoa(50), ntoa(60)])

      // test de-duplication
      await contract.add(ntoa(10))
      await contract.add(ntoa(60))
      await expectList([ntoa(10), ntoa(20), ntoa(30), ntoa(40), ntoa(50), ntoa(60)])
    })

    it('from outsider', async () => {
      await expect(contract.connect(outsider).add(ntoa(1))).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('adds()', () => {
    it('normally', async () => {
      await contract.adds([ntoa(10), ntoa(11), ntoa(20), ntoa(21)])
      await expectList([ntoa(10), ntoa(20), ntoa(30), ntoa(40), ntoa(50), ntoa(11), ntoa(21)])
    })

    it('from outsider', async () => {
      await expect(contract.connect(outsider).adds([ntoa(1)])).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('remove()', () => {
    it('first item', async () => {
      await contract.remove(ntoa(10))
      await expectList([ntoa(50), ntoa(20), ntoa(30), ntoa(40)])

      await contract.remove(ntoa(50))
      await expectList([ntoa(40), ntoa(20), ntoa(30)])

      await contract.remove(ntoa(40))
      await expectList([ntoa(30), ntoa(20)])

      await contract.remove(ntoa(30))
      await expectList([ntoa(20)])

      await contract.remove(ntoa(20))
      await expectList([])
    })

    it('last item', async () => {
      await contract.remove(ntoa(50))
      await expectList([ntoa(10), ntoa(20), ntoa(30), ntoa(40)])

      await contract.remove(ntoa(40))
      await expectList([ntoa(10), ntoa(20), ntoa(30)])

      await contract.remove(ntoa(30))
      await expectList([ntoa(10), ntoa(20)])

      await contract.remove(ntoa(20))
      await expectList([ntoa(10)])

      await contract.remove(ntoa(10))
      await expectList([])
    })

    it('middle item', async () => {
      await contract.remove(ntoa(30))
      await expectList([ntoa(10), ntoa(20), ntoa(50), ntoa(40)])

      await contract.remove(ntoa(20))
      await expectList([ntoa(10), ntoa(40), ntoa(50)])

      await contract.remove(ntoa(40))
      await expectList([ntoa(10), ntoa(50)])
    })

    it('missing item', async () => {
      await contract.remove(ntoa(100))
      await expectList([ntoa(10), ntoa(20), ntoa(30), ntoa(40), ntoa(50)])
    })

    it('from outsider', async () => {
      await expect(contract.connect(outsider).remove(ntoa(1))).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('removes()', () => {
    it('normally', async () => {
      await contract.removes([ntoa(10), ntoa(11), ntoa(20), ntoa(21)])
      await expectList([ntoa(50), ntoa(40), ntoa(30)])
    })

    it('from outsider', async () => {
      await expect(contract.connect(outsider).removes([ntoa(1)])).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  it('length()', async () => {
    expect(await contract.length()).to.equal(5)
  })

  it('has()', async () => {
    expect(await contract.has(ntoa(10))).to.be.true
    expect(await contract.has(ntoa(100))).to.be.false
  })

  it('prev()', async () => {
    expect(await contract.prev(ntoa(10))).to.equal(zeroAddress)
    expect(await contract.prev(ntoa(20))).to.equal(ntoa(10))
    expect(await contract.prev(ntoa(30))).to.equal(ntoa(20))
    expect(await contract.prev(ntoa(40))).to.equal(ntoa(30))
    expect(await contract.prev(ntoa(50))).to.equal(ntoa(40))
    expect(await contract.prev(ntoa(60))).to.equal(zeroAddress)

    expect(await contract.prev(zeroAddress)).to.equal(zeroAddress)
  })

  it('next()', async () => {
    expect(await contract.next(ntoa(10))).to.equal(ntoa(20))
    expect(await contract.next(ntoa(20))).to.equal(ntoa(30))
    expect(await contract.next(ntoa(30))).to.equal(ntoa(40))
    expect(await contract.next(ntoa(40))).to.equal(ntoa(50))
    expect(await contract.next(ntoa(50))).to.equal(zeroAddress)

    expect(await contract.next(zeroAddress)).to.equal(zeroAddress)
  })

  it('list()', async () => {
    let actual = await contract.list(0, 2)
    expect(actual.addresses).to.eql([ntoa(10), ntoa(20)])
    expect(actual.newCursor).to.equal(2)

    actual = await contract.list(actual.newCursor, 2)
    expect(actual.addresses).to.eql([ntoa(30), ntoa(40)])
    expect(actual.newCursor).to.equal(4)

    actual = await contract.list(actual.newCursor, 2)
    expect(actual.addresses).to.eql([ntoa(50)])
    expect(actual.newCursor).to.equal(5)
  })
})
