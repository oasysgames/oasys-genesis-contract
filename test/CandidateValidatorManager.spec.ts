import { ethers } from 'hardhat'
import { expect } from 'chai'

import { ntoa } from './helpers'
import type { CandidateValidatorManager__factory as Factory } from '../typechain-types'

describe('CandidateValidatorManager', async () => {
  let factory: Factory
  beforeEach(async () => {
    factory = await ethers.getContractFactory('CandidateValidatorManager')
  })

  describe('constructor()', async () => {
    it('should be reverted by `NullAddress`', async () => {
      await expect(factory.deploy(ntoa(0), ntoa(1), ntoa(1))).to.be.revertedWith('NullAddress')
      await expect(factory.deploy(ntoa(1), ntoa(0), ntoa(1))).to.be.revertedWith('NullAddress')
      await expect(factory.deploy(ntoa(1), ntoa(1), ntoa(0))).to.be.revertedWith('NullAddress')
    })
  })

  describe('afterStateUpdate()', () => {
    it('should be reverted by `UnauthorizedSender`', async () => {
      const contract = await factory.deploy(ntoa(1), ntoa(1), ntoa(1))
      const tx = contract.afterStakeUpdate(ntoa(1))
      await expect(tx).to.be.revertedWith('UnauthorizedSender')
    })
  })
})
