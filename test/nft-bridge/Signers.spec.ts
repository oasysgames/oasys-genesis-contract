import web3 from 'web3'
import abi from 'web3-eth-abi'
import { ethers, network } from 'hardhat'
import { ContractFactory, Contract } from 'ethers'
import { SignerWithAddress as Account } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { chainid, makeSignature, zeroAddress } from '../helpers'

const getHash = (nonce: number, to: string, encodedSelector: string) => {
  const msg = web3.utils.encodePacked(
    { type: 'uint256', value: String(nonce) },
    { type: 'address', value: to },
    { type: 'bytes', value: encodedSelector },
  )
  return ethers.utils.keccak256(msg!)
}

const getAddSignerHash = (nonce: number, to: string, signer: string) => {
  const funcSig = abi.encodeFunctionSignature('addSigner(address,bytes)')
  const funcParamsSig = abi.encodeParameters(['address'], [signer])
  const encodedSelector = funcSig + funcParamsSig.slice(2)
  return getHash(nonce, to, encodedSelector)
}

const getRemoveSignerHash = (nonce: number, to: string, signer: string) => {
  const funcSig = abi.encodeFunctionSignature('removeSigner(address,bytes)')
  const funcParamsSig = abi.encodeParameters(['address'], [signer])
  const encodedSelector = funcSig + funcParamsSig.slice(2)
  return getHash(nonce, to, encodedSelector)
}

const getUpdateThresholdHash = (nonce: number, to: string, threshold: number) => {
  const funcSig = abi.encodeFunctionSignature('updateThreshold(uint256,bytes)')
  const funcParamsSig = abi.encodeParameters(['uint256'], [threshold])
  const encodedSelector = funcSig + funcParamsSig.slice(2)
  return getHash(nonce, to, encodedSelector)
}

describe('Signers', () => {
  let accounts: Account[]
  let signer1: Account
  let signer2: Account
  let factory: ContractFactory
  let nonce: number

  const getContract = async (initialSigners: Account[], initialThreshold?: number): Promise<Contract> =>
    await factory.deploy(
      initialSigners.map((x) => x.address),
      initialThreshold ?? initialSigners.length,
    )

  before(async () => {
    accounts = await ethers.getSigners()
    signer1 = accounts[18]
    signer2 = accounts[19]
    factory = await ethers.getContractFactory('Signers')
  })

  beforeEach(() => {
    nonce = 0
  })

  describe('verifySignatures()', () => {
    type override = {
      chainid?: number
    }

    const getSignature = async (
      contract: Contract,
      signers: Account[],
      add: Account,
      overrides: number[],
    ): Promise<Uint8Array> => {
      const hash = getAddSignerHash(nonce++, contract.address, add.address)
      const signatures = await Promise.all(
        signers.map((signer, i) => makeSignature(signer, hash, overrides[i] ?? chainid)),
      )
      return ethers.utils.concat(signatures)
    }

    let signer1: Account
    let signer2: Account
    let signer3: Account

    before(async () => {
      signer1 = accounts[1]
      signer2 = accounts[2]
      signer3 = accounts[3]
    })

    it('invalid chain id', async () => {
      const contract = await getContract([signer1])
      const signatures = getSignature(contract, [signer1], signer2, [chainid + 1])
      const tx = contract.addSigner(signer2.address, signatures)
      await expect(tx).to.be.revertedWith('Invalid signatures')
    })

    it('below Threshold', async () => {
      let contract = await getContract([signer1, signer2])
      let signatures = getSignature(contract, [signer2, signer1], signer3, [])

      // success
      await contract.addSigner(signer3.address, signatures)

      await network.provider.send('hardhat_reset')

      // reverted
      contract = await getContract([signer1, signer2])
      signatures = getSignature(contract, [signer2], signer3, [])
      const tx = contract.addSigner(signer3.address, signatures)
      await expect(tx).to.be.revertedWith('Invalid signatures')
    })
  })

  describe('addSigner()', async () => {
    let adding: Account
    let contract: Contract

    beforeEach(async () => {
      adding = accounts[1]
      contract = await getContract([signer1])
    })

    it('normally', async () => {
      expect(await contract.nonce()).to.equal(0)
      expect(await contract.getSigners()).to.eql([signer1.address])

      const hash = getAddSignerHash(nonce++, contract.address, adding.address)
      const signatures = await makeSignature(signer1, hash, chainid)
      await contract.addSigner(adding.address, signatures)
      expect(await contract.nonce()).to.equal(1)
      expect(await contract.getSigners()).to.eql([signer1.address, adding.address])
    })

    it('invalid nonce', async () => {
      const hash = getAddSignerHash(nonce + 1, contract.address, adding.address)
      const signatures = await makeSignature(signer1, hash, chainid)
      const tx = contract.addSigner(adding.address, signatures)
      await expect(tx).to.be.revertedWith('Invalid signatures')
    })

    it('invalid to', async () => {
      const hash = getAddSignerHash(nonce++, zeroAddress, adding.address)
      const signatures = await makeSignature(signer1, hash, chainid)
      const tx = contract.addSigner(signer2.address, signatures)
      await expect(tx).to.be.revertedWith('Invalid signatures')
    })

    it('already added', async () => {
      const hash1 = getAddSignerHash(nonce++, contract.address, adding.address)
      const signatures1 = await makeSignature(signer1, hash1, chainid)
      await contract.addSigner(adding.address, signatures1)
      expect(await contract.getSigners()).to.eql([signer1.address, adding.address])

      const hash2 = getAddSignerHash(nonce++, contract.address, adding.address)
      const signatures2 = await makeSignature(signer1, hash2, chainid)
      const tx = contract.addSigner(adding.address, signatures2)
      await expect(tx).to.be.revertedWith('already added')
    })
  })

  describe('removeSigner()', () => {
    it('normally', async () => {
      const contract = await getContract([signer1, signer2], 1)
      expect(await contract.nonce()).to.equal(0)
      expect(await contract.getSigners()).to.eql([signer1.address, signer2.address])

      const hash = getRemoveSignerHash(nonce++, contract.address, signer1.address)
      const signatures = await makeSignature(signer1, hash, chainid)
      await contract.removeSigner(signer1.address, signatures)
      expect(await contract.nonce()).to.equal(1)
      expect(await contract.getSigners()).to.eql([signer2.address])
    })

    it('invalid nonce', async () => {
      const contract = await getContract([signer1], 1)
      const hash = getRemoveSignerHash(nonce + 1, contract.address, signer1.address)
      const signatures = await makeSignature(signer1, hash, chainid)
      const tx = contract.removeSigner(signer1.address, signatures)
      await expect(tx).to.be.revertedWith('Invalid signatures')
    })

    it('invalid to', async () => {
      const contract = await getContract([signer1], 1)
      const hash = getRemoveSignerHash(nonce++, zeroAddress, signer1.address)
      const signatures = await makeSignature(signer1, hash, chainid)
      const tx = contract.removeSigner(signer1.address, signatures)
      await expect(tx).to.be.revertedWith('Invalid signatures')
    })

    it('signer shortage', async () => {
      const contract = await getContract([signer1, signer2], 2)
      const hash = getRemoveSignerHash(nonce++, contract.address, signer1.address)
      const signatures = ethers.utils.concat([
        await makeSignature(signer2, hash, chainid),
        await makeSignature(signer1, hash, chainid),
      ])
      const tx = contract.removeSigner(signer1.address, signatures)
      await expect(tx).to.be.revertedWith('Signer shortage.')
    })
  })

  describe('updateThreshold()', () => {
    it('normally', async () => {
      const contract = await getContract([signer1, signer2], 1)
      expect(await contract.nonce()).to.equal(0)
      expect(await contract.threshold()).to.equal(1)

      const hash = getUpdateThresholdHash(nonce++, contract.address, 2)
      const signatures = await makeSignature(signer1, hash, chainid)
      await contract.updateThreshold(2, signatures)
      expect(await contract.nonce()).to.equal(1)
      expect(await contract.threshold()).to.equal(2)
    })

    it('invalid nonce', async () => {
      const contract = await getContract([signer1], 1)
      const hash = getUpdateThresholdHash(nonce + 1, contract.address, 2)
      const signatures = await makeSignature(signer1, hash, chainid)
      const tx = contract.updateThreshold(2, signatures)
      await expect(tx).to.be.revertedWith('Invalid signatures')
    })

    it('invalid to', async () => {
      const contract = await getContract([signer1], 1)
      const hash = getUpdateThresholdHash(nonce++, zeroAddress, 2)
      const signatures = await makeSignature(signer1, hash, chainid)
      const tx = contract.updateThreshold(2, signatures)
      await expect(tx).to.be.revertedWith('Invalid signatures')
    })

    it('signer shortage', async () => {
      const contract = await getContract([signer1], 1)
      const hash = getUpdateThresholdHash(nonce++, contract.address, 2)
      const signatures = await makeSignature(signer1, hash, chainid)
      const tx = contract.updateThreshold(2, signatures)
      await expect(tx).to.be.revertedWith('Signer shortage.')
    })
  })
})
