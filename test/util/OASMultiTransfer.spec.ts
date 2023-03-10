import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { Contract } from 'ethers'
import { SignerWithAddress as Account } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'

const parseUnits = ethers.utils.parseUnits

const expectBalance = async (address: string, ether: BigNumber) => {
  const actual = await ethers.provider.getBalance(address)
  expect(actual).to.equal(ether)
}

describe('OASMultiTransfer', () => {
  let signer: Account
  let contract: Contract

  before(async () => {
    signer = (await ethers.getSigners())[0]
  })

  beforeEach(async () => {
    const factory = await ethers.getContractFactory('OASMultiTransfer')
    contract = (await factory.deploy()).connect(signer)
  })

  const tos = [
    '0xad2148f0E70f450974713AFcFD6991f03e14084A',
    '0x0000000000000000000000000000000000000000',
    '0xAFFe1007893bFCa4fB86f204a6C812e83C703452',
  ]
  const amounts = [parseUnits('1'), parseUnits('2'), parseUnits('3')]

  it('normally', async () => {
    // check initial balance
    await expectBalance(signer.address, parseUnits('10000'))

    // transfer
    await contract.transfer(tos, amounts, { value: parseUnits('100') })

    // check recipient balances
    await expectBalance(tos[0], amounts[0])
    await expectBalance(tos[1], parseUnits('0'))
    await expectBalance(tos[2], amounts[2])

    // check refund
    await expectBalance(contract.address, parseUnits('0'))
    await expectBalance(signer.address, parseUnits('9996'))
  })

  it('value is shortage', async () => {
    const tx = contract.transfer(tos, amounts, { value: parseUnits('1') })
    await expect(tx).to.be.revertedWith(`TransferFailed("${tos[2]}", ${amounts[2]})`)
  })
})
