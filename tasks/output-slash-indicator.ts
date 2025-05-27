import { task } from 'hardhat/config'

import { Chains, PredeployContracts, assertImmutableVariable, codeAndHash } from './lib'

task('output-slash-indicator').setAction(async (_, hre) => {
  const slashIndicatorFactory = await hre.ethers.getContractFactory('SlashIndicator')

  // Mainnet
  const mainnet = await slashIndicatorFactory.deploy(
    PredeployContracts.Environment,
    PredeployContracts.StakeManager,
    Chains.mainnet.chainID,
  )
  await assertImmutableVariable(mainnet.environment, PredeployContracts.Environment)
  await assertImmutableVariable(mainnet.stakeManager, PredeployContracts.StakeManager)
  await assertImmutableVariable(mainnet.chainId, Chains.mainnet.chainID)

  // Testnet
  const testnet = await slashIndicatorFactory.deploy(
    PredeployContracts.Environment,
    PredeployContracts.StakeManager,
    Chains.testnet.chainID,
  )
  await assertImmutableVariable(testnet.environment, PredeployContracts.Environment)
  await assertImmutableVariable(testnet.stakeManager, PredeployContracts.StakeManager)
  await assertImmutableVariable(testnet.chainId, Chains.testnet.chainID)

  // Localnet
  const localnet = await slashIndicatorFactory.deploy(
    PredeployContracts.Environment,
    PredeployContracts.StakeManager,
    Chains.localnet.chainID,
  )
  await assertImmutableVariable(localnet.environment, PredeployContracts.Environment)
  await assertImmutableVariable(localnet.stakeManager, PredeployContracts.StakeManager)
  await assertImmutableVariable(localnet.chainId, Chains.localnet.chainID)

  const output = {
    mainnet: await codeAndHash(hre, mainnet.address),
    testnet: await codeAndHash(hre, testnet.address),
    localnet: await codeAndHash(hre, localnet.address),
  }
  console.log(JSON.stringify(output, null, 2))
})
