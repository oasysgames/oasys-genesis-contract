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
    await ethers.provider.send('hardhat_reset', [])

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

  it('prevent reentrancy attack', async () => {
    // check initial balance
    await expectBalance(signer.address, parseUnits('10000'))

    // deploy the attack contract
    const factory = await ethers.getContractFactory('TestOASMultiTransferReentrancy')
    const reentrancy = await factory.deploy()

    // transfer
    const _tos = [...tos, reentrancy.address]
    const _amounts = [...amounts, parseUnits('1')]
    await contract.transfer(_tos, _amounts, { value: parseUnits('10') })

    // check the error message
    const errMsg = await reentrancy.reason()
    expect(errMsg).to.equal('ReentrancyGuard: reentrant call')

    // check recipient balances
    await expectBalance(_tos[0], _amounts[0])
    await expectBalance(_tos[1], parseUnits('0'))
    await expectBalance(_tos[2], _amounts[2])

    // check the contract balance
    await expectBalance(reentrancy.address, parseUnits('1'))

    // check refund
    await expectBalance(contract.address, parseUnits('0'))
    await expectBalance(signer.address, parseUnits('9995'))
  })
})
