import { network } from 'hardhat'
import { Contract, BigNumber } from 'ethers'
import { SignerWithAddress as Account } from '@nomiclabs/hardhat-ethers/signers'
import { toWei, fromWei, toDecimal } from 'web3-utils'
import { expect } from 'chai'

interface EnvironmentValue {
  startBlock: number
  startEpoch: number
  blockPeriod: number
  epochPeriod: number
  rewardRate: number
  validatorThreshold: string
  jailThreshold: number
  jailPeriod: number
}

interface ValidatorInfo {
  operator: string
  active: boolean
  stakes: BigNumber
  commissionRate: BigNumber
  jailEpoch: BigNumber
}

interface StakerInfo {
  stakes: BigNumber
  unstakes: BigNumber
}

class Validator {
  constructor(private _contract: Contract, public owner: Account, public operator: Account) {}

  stake(validator: Validator, amount: string, sender?: Account) {
    return this._contract.connect(sender || this.owner).stake(validator.owner.address, { value: toWei(amount) })
  }

  unstake(validator: Validator, amount: string, sender?: Account) {
    return this._contract.connect(sender || this.owner).unstake(validator.owner.address, toWei(amount))
  }

  joinValidator(operator?: string) {
    return this._contract.connect(this.owner).joinValidator(operator || this.operator.address)
  }

  updateOperator(newOperator: string, sender?: Account) {
    return this._contract.connect(sender || this.owner).updateOperator(newOperator)
  }

  updateCommissionRate(newRate: number, sender?: Account) {
    return this._contract.connect(sender || this.owner).updateCommissionRate(newRate)
  }

  activateValidator(sender?: Account) {
    return this._contract.connect(sender || this.operator).activateValidator(this.owner.address)
  }

  deactivateValidator(sender?: Account) {
    return this._contract.connect(sender || this.operator).deactivateValidator(this.owner.address)
  }

  claimCommissions(sender?: Account, epochs?: number) {
    return this._contract.connect(sender || this.owner).claimCommissions(this.owner.address, epochs ?? 0)
  }

  async getInfo(): Promise<ValidatorInfo> {
    return await this._contract.getValidatorInfo(this.owner.address)
  }

  async slash(validator: Validator) {
    return await this._contract.connect(this.operator).slash(validator.operator.address)
  }

  async expectBalance(expectEther: string) {
    const actual = await this.owner.getBalance()
    expect(fromWei(actual.toString())).to.match(new RegExp(`^${expectEther}`))
  }

  async expectStakes(epoch: number, expectStakers: Staker[], expectEthers: string[], page = 1, perPage = 50) {
    const { _stakers, stakes } = await this._contract.getValidatorStakes(this.owner.address, epoch, page, perPage)

    let _expectStakers = expectStakers.map((x) => x.address)
    if (expectStakers.length < perPage) {
      const range = Array.from(Array(perPage - expectStakers.length).keys())
      _expectStakers = [..._expectStakers, ...range.map((_) => zeroAddress)]
      expectEthers = [...expectEthers, ...range.map((x) => '0')]
    }

    expect(_stakers).to.eql(_expectStakers)
    expect(stakes).to.eql(expectEthers.map((x) => toBNWei(x)))
  }

  async expectCommissions(expectEther: string, epochs?: number) {
    const actual = await this._contract.getCommissions(this.owner.address, epochs || 0)
    expect(fromWei(actual.toString())).to.match(new RegExp(`^${expectEther}`))
  }

  async expectRewards(expectEther: string, epochs?: number) {
    const actual = await this._contract.getRewards(this.owner.address, epochs || 0)
    expect(actual).to.equal(toBNWei(expectEther))
  }

  async expectSlashes(epoch: number, expectBlocks: number, expectSlashes: number) {
    const { blocks, slashes } = await this._contract.getBlockAndSlashes(this.owner.address, epoch)
    expect(blocks).to.equal(expectBlocks)
    expect(slashes).to.equal(expectSlashes)
  }
}

class Staker {
  constructor(private _contract: Contract, public signer: Account) {}

  get address(): string {
    return this.signer.address
  }

  get contract(): Contract {
    return this._contract.connect(this.signer)
  }

  stake(validator: Validator, amount: string) {
    return this.contract.stake(validator.owner.address, { value: toWei(amount) })
  }

  unstake(validator: Validator, amount: string) {
    return this.contract.unstake(validator.owner.address, toWei(amount))
  }

  claimRewards(validator: Validator, epochs: number) {
    return this.contract.claimRewards(validator.owner.address, epochs)
  }

  claimUnstakes() {
    return this.contract.claimUnstakes()
  }

  async expectBalance(expectEther: string) {
    const actual = await this.signer.getBalance()
    expect(fromWei(actual.toString())).to.match(new RegExp(`^${expectEther}`))
  }

  async expectRewards(expectEther: string, validator: Validator, epochs?: number) {
    const rewards = await this.contract.getRewards(this.address, validator.owner.address, epochs || 0)
    expect(fromWei(rewards.toString())).to.match(new RegExp(`^${expectEther}`))
  }

  async expectTotalStake(expectEther: string) {
    const { stakes } = await this.getInfo()
    expect(stakes).to.equal(toBNWei(expectEther))
  }

  async expectStakes(
    epoch: number,
    expectValidators: Validator[],
    expectStakes: string[],
    expectStakeRequests?: string[],
    expectUnstakeRequests?: string[],
  ) {
    const { _validators, stakes, stakeRequests, unstakeRequests } = await this.contract.getStakerStakes(
      this.address,
      epoch,
    )
    expect(_validators).to.eql(expectValidators.map((x) => x.owner.address))
    expect(stakes).to.eql(expectStakes.map((x) => toBNWei(x)))
    if (expectStakeRequests) {
      expect(stakeRequests).to.eql(expectStakeRequests.map((x) => toBNWei(x)))
    }
    if (expectUnstakeRequests) {
      expect(unstakeRequests).to.eql(expectUnstakeRequests.map((x) => toBNWei(x)))
    }
  }
  async getInfo(): Promise<StakerInfo> {
    return await this.contract.getStakerInfo(this.signer.address)
  }
}

const getBlockNumber = async () => {
  const r = await network.provider.send('eth_getBlockByNumber', ['latest', false])
  return toDecimal(r.number)
}

const mining = async (targetBlockNumber: number) => {
  while (true) {
    if ((await getBlockNumber()) >= targetBlockNumber) return
    await network.provider.send('evm_mine')
  }
}

const fromEther = (ether: string) => BigNumber.from(toWei(ether))

const toBNWei = (ether: string) => BigNumber.from(toWei(ether))

const zeroAddress = '0x0000000000000000000000000000000000000000'

export {
  EnvironmentValue,
  ValidatorInfo,
  StakerInfo,
  Validator,
  Staker,
  getBlockNumber,
  mining,
  fromEther,
  toBNWei,
  zeroAddress,
}
