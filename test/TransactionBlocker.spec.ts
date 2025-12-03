import { ethers } from 'hardhat'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Contract } from 'ethers'

describe('TransactionBlocker', () => {
  let transactionBlocker: Contract
  let factory: any
  let accounts: SignerWithAddress[]
  let admin: SignerWithAddress
  let operator: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let user3: SignerWithAddress
  let zeroAddress: string

  beforeEach(async () => {
    accounts = await ethers.getSigners()
    admin = accounts[0]
    operator = accounts[1]
    user1 = accounts[2]
    user2 = accounts[3]
    user3 = accounts[4]
    zeroAddress = ethers.constants.AddressZero

    factory = await ethers.getContractFactory('TransactionBlocker')
  })

  describe('constructor()', () => {
    it('should deploy with multiple admins and operators', async () => {
      transactionBlocker = await factory.deploy(
        [admin.address, user1.address],
        [operator.address, user2.address]
      )
      await transactionBlocker.deployed()

      expect(await transactionBlocker.hasRole(await transactionBlocker.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true
      expect(await transactionBlocker.hasRole(await transactionBlocker.DEFAULT_ADMIN_ROLE(), user1.address)).to.be.true
      expect(await transactionBlocker.hasRole(await transactionBlocker.OPERATOR_ROLE(), operator.address)).to.be.true
      expect(await transactionBlocker.hasRole(await transactionBlocker.OPERATOR_ROLE(), user2.address)).to.be.true
    })

    it('should revert when both arrays contain zero address', async () => {
      await expect(
        factory.deploy([zeroAddress], [zeroAddress])
      ).to.be.revertedWithCustomError(factory, 'NullAddress')
    })

    it('should allow empty admin array', async () => {
      transactionBlocker = await factory.deploy([], [operator.address])
      await transactionBlocker.deployed()
      expect(await transactionBlocker.hasRole(await transactionBlocker.OPERATOR_ROLE(), operator.address)).to.be.true
    })

    it('should allow empty operator array', async () => {
      transactionBlocker = await factory.deploy([admin.address], [])
      await transactionBlocker.deployed()
      expect(await transactionBlocker.hasRole(await transactionBlocker.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true
    })
  })

  describe('setBlockedAll()', () => {
    beforeEach(async () => {
      transactionBlocker = await factory.deploy([admin.address], [operator.address])
      await transactionBlocker.deployed()
    })

    it('should set global blocking state to true', async () => {
      await expect(transactionBlocker.connect(operator).setBlockedAll(true))
        .to.emit(transactionBlocker, 'BlockedAllSet')
        .withArgs(true)

      expect(await transactionBlocker.isBlockedAll()).to.be.true
    })

    it('should set global blocking state to false', async () => {
      await transactionBlocker.connect(operator).setBlockedAll(true)
      await expect(transactionBlocker.connect(operator).setBlockedAll(false))
        .to.emit(transactionBlocker, 'BlockedAllSet')
        .withArgs(false)

      expect(await transactionBlocker.isBlockedAll()).to.be.false
    })

    it('should revert when called by non-operator', async () => {
      await expect(
        transactionBlocker.connect(user1).setBlockedAll(true)
      ).to.be.revertedWithCustomError(factory, 'UnauthorizedSender')
    })

    it('should allow admin to call if admin is also operator', async () => {
      const adminOperator = accounts[5]
      transactionBlocker = await factory.deploy([adminOperator.address], [adminOperator.address])
      await transactionBlocker.deployed()

      await expect(transactionBlocker.connect(adminOperator).setBlockedAll(true))
        .to.emit(transactionBlocker, 'BlockedAllSet')
        .withArgs(true)
    })
  })

  describe('blockAddress()', () => {
    beforeEach(async () => {
      transactionBlocker = await factory.deploy([admin.address], [operator.address])
      await transactionBlocker.deployed()
    })

    it('should block a single address', async () => {
      await expect(transactionBlocker.connect(operator).blockAddress(user1.address))
        .to.emit(transactionBlocker, 'BlockedAddressAdded')
        .withArgs(user1.address)

      expect(await transactionBlocker.isBlockedAddress(user1.address)).to.be.true
      const blockedAddresses = await transactionBlocker.getBlockedAddresses()
      expect(blockedAddresses).to.include(user1.address)
    })

    it('should revert when blocking zero address', async () => {
      await expect(
        transactionBlocker.connect(operator).blockAddress(zeroAddress)
      ).to.be.revertedWithCustomError(factory, 'NullAddress')
    })

    it('should revert when blocking already blocked address', async () => {
      await transactionBlocker.connect(operator).blockAddress(user1.address)
      await expect(
        transactionBlocker.connect(operator).blockAddress(user1.address)
      ).to.be.revertedWithCustomError(factory, 'AlreadyBlocked')
    })

    it('should revert when called by non-operator', async () => {
      await expect(
        transactionBlocker.connect(user1).blockAddress(user2.address)
      ).to.be.revertedWithCustomError(factory, 'UnauthorizedSender')
    })
  })

  describe('bulkBlockAddresses()', () => {
    beforeEach(async () => {
      transactionBlocker = await factory.deploy([admin.address], [operator.address])
      await transactionBlocker.deployed()
    })

    it('should block multiple addresses', async () => {
      const addresses = [user1.address, user2.address, user3.address]

      const tx = transactionBlocker.connect(operator).bulkBlockAddresses(addresses)
      for (const addr of addresses) {
        await expect(tx).to.emit(transactionBlocker, 'BlockedAddressAdded').withArgs(addr)
      }

      expect(await transactionBlocker.isBlockedAddress(user1.address)).to.be.true
      expect(await transactionBlocker.isBlockedAddress(user2.address)).to.be.true
      expect(await transactionBlocker.isBlockedAddress(user3.address)).to.be.true

      const blockedAddresses = await transactionBlocker.getBlockedAddresses()
      expect(blockedAddresses.length).to.equal(3)
      expect(blockedAddresses).to.include.members(addresses)
    })

    it('should revert when array contains zero address', async () => {
      await expect(
        transactionBlocker.connect(operator).bulkBlockAddresses([user1.address, zeroAddress])
      ).to.be.revertedWithCustomError(factory, 'NullAddress')
    })

    it('should revert when array contains already blocked address', async () => {
      await transactionBlocker.connect(operator).blockAddress(user1.address)
      await expect(
        transactionBlocker.connect(operator).bulkBlockAddresses([user1.address, user2.address])
      ).to.be.revertedWithCustomError(factory, 'AlreadyBlocked')
    })

    it('should revert when array is empty', async () => {
      await expect(transactionBlocker.connect(operator).bulkBlockAddresses([])).to.be.revertedWithCustomError(factory, 'EmptyArray')
    })

    it('should revert when called by non-operator', async () => {
      await expect(
        transactionBlocker.connect(user1).bulkBlockAddresses([user2.address])
      ).to.be.revertedWithCustomError(factory, 'UnauthorizedSender')
    })
  })

  describe('unblockAddress()', () => {
    beforeEach(async () => {
      transactionBlocker = await factory.deploy([admin.address], [operator.address])
      await transactionBlocker.deployed()
      await transactionBlocker.connect(operator).blockAddress(user1.address)
    })

    it('should unblock a single address', async () => {
      await expect(transactionBlocker.connect(operator).unblockAddress(user1.address))
        .to.emit(transactionBlocker, 'BlockedAddressRemoved')
        .withArgs(user1.address)

      expect(await transactionBlocker.isBlockedAddress(user1.address)).to.be.false
      const blockedAddresses = await transactionBlocker.getBlockedAddresses()
      expect(blockedAddresses).to.not.include(user1.address)
    })

    it('should revert when unblocking zero address', async () => {
      await expect(
        transactionBlocker.connect(operator).unblockAddress(zeroAddress)
      ).to.be.revertedWithCustomError(factory, 'NullAddress')
    })

    it('should revert when unblocking non-blocked address', async () => {
      await expect(
        transactionBlocker.connect(operator).unblockAddress(user2.address)
      ).to.be.revertedWithCustomError(factory, 'NotBlocked')
    })

    it('should revert when called by non-operator', async () => {
      await expect(
        transactionBlocker.connect(user1).unblockAddress(user1.address)
      ).to.be.revertedWithCustomError(factory, 'UnauthorizedSender')
    })
  })

  describe('bulkUnblockAddresses()', () => {
    beforeEach(async () => {
      transactionBlocker = await factory.deploy([admin.address], [operator.address])
      await transactionBlocker.deployed()
      await transactionBlocker.connect(operator).bulkBlockAddresses([user1.address, user2.address, user3.address])
    })

    it('should unblock multiple addresses', async () => {
      const addresses = [user1.address, user2.address]

      const tx = transactionBlocker.connect(operator).bulkUnblockAddresses(addresses)
      for (const addr of addresses) {
        await expect(tx).to.emit(transactionBlocker, 'BlockedAddressRemoved').withArgs(addr)
      }

      expect(await transactionBlocker.isBlockedAddress(user1.address)).to.be.false
      expect(await transactionBlocker.isBlockedAddress(user2.address)).to.be.false
      expect(await transactionBlocker.isBlockedAddress(user3.address)).to.be.true

      const blockedAddresses = await transactionBlocker.getBlockedAddresses()
      expect(blockedAddresses.length).to.equal(1)
      expect(blockedAddresses).to.include(user3.address)
    })

    it('should revert when array contains zero address', async () => {
      await expect(
        transactionBlocker.connect(operator).bulkUnblockAddresses([user1.address, zeroAddress])
      ).to.be.revertedWithCustomError(factory, 'NullAddress')
    })

    it('should revert when array contains non-blocked address', async () => {
      await transactionBlocker.connect(operator).unblockAddress(user1.address)
      await expect(
        transactionBlocker.connect(operator).bulkUnblockAddresses([user1.address, user2.address])
      ).to.be.revertedWithCustomError(factory, 'NotBlocked')
    })

    it('should revert when array is empty', async () => {
      await expect(transactionBlocker.connect(operator).bulkUnblockAddresses([])).to.be.revertedWithCustomError(factory, 'EmptyArray')
    })

    it('should revert when called by non-operator', async () => {
      await expect(
        transactionBlocker.connect(user1).bulkUnblockAddresses([user2.address])
      ).to.be.revertedWithCustomError(factory, 'UnauthorizedSender')
    })
  })

  describe('complex scenarios', () => {
    beforeEach(async () => {
      transactionBlocker = await factory.deploy([admin.address], [operator.address])
      await transactionBlocker.deployed()
    })

    it('should handle blocking and unblocking multiple addresses in sequence', async () => {
      // Block addresses
      await transactionBlocker.connect(operator).blockAddress(user1.address)
      await transactionBlocker.connect(operator).blockAddress(user2.address)
      await transactionBlocker.connect(operator).bulkBlockAddresses([user3.address])

      let blockedAddresses = await transactionBlocker.getBlockedAddresses()
      expect(blockedAddresses.length).to.equal(3)

      // Unblock one
      await transactionBlocker.connect(operator).unblockAddress(user2.address)
      blockedAddresses = await transactionBlocker.getBlockedAddresses()
      expect(blockedAddresses.length).to.equal(2)
      expect(blockedAddresses).to.include.members([user1.address, user3.address])

      // Block again
      await transactionBlocker.connect(operator).blockAddress(user2.address)
      blockedAddresses = await transactionBlocker.getBlockedAddresses()
      expect(blockedAddresses.length).to.equal(3)

      // Unblock all
      await transactionBlocker.connect(operator).bulkUnblockAddresses([user1.address, user2.address, user3.address])
      blockedAddresses = await transactionBlocker.getBlockedAddresses()
      expect(blockedAddresses.length).to.equal(0)
    })

    it('should handle global blocking and address blocking independently', async () => {
      await transactionBlocker.connect(operator).setBlockedAll(true)
      await transactionBlocker.connect(operator).blockAddress(user1.address)

      expect(await transactionBlocker.isBlockedAll()).to.be.true
      expect(await transactionBlocker.isBlockedAddress(user1.address)).to.be.true

      await transactionBlocker.connect(operator).setBlockedAll(false)
      expect(await transactionBlocker.isBlockedAll()).to.be.false
      expect(await transactionBlocker.isBlockedAddress(user1.address)).to.be.true
    })

    it('should maintain correct array order after swap-and-pop unblocking', async () => {
      // Block multiple addresses
      await transactionBlocker.connect(operator).bulkBlockAddresses([
        user1.address,
        user2.address,
        user3.address
      ])

      let blockedAddresses = await transactionBlocker.getBlockedAddresses()
      expect(blockedAddresses.length).to.equal(3)

      // Unblock middle address (tests swap-and-pop)
      await transactionBlocker.connect(operator).unblockAddress(user2.address)
      blockedAddresses = await transactionBlocker.getBlockedAddresses()
      expect(blockedAddresses.length).to.equal(2)
      expect(blockedAddresses).to.include.members([user1.address, user3.address])
      expect(blockedAddresses).to.not.include(user2.address)

      // Verify mapping is correct
      expect(await transactionBlocker.isBlockedAddress(user1.address)).to.be.true
      expect(await transactionBlocker.isBlockedAddress(user2.address)).to.be.false
      expect(await transactionBlocker.isBlockedAddress(user3.address)).to.be.true
    })
  })
})
