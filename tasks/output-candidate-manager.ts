import * as crypto from 'crypto'

import type { HardhatRuntimeEnvironment as HRE } from 'hardhat/types'
import { task } from 'hardhat/config'

type Networks = 'mainnet' | 'testnet'

type Storage = { [slot: string]: string }

type Output = {
  AddressList: {
    code: string
    hash: string
    storage: { [network in Networks]: Storage }
  }
  CandidateValidatorManager: {
    code: string
    hash: string
  }
}

const PredeployContracts = {
  Environment: '0x0000000000000000000000000000000000001000',
  StakeManager: '0x0000000000000000000000000000000000001001',
  CandidateValidatorManagerHighStakes: '0x520000000000000000000000000000000000002D',
  CandidateValidatorManager: '0x520000000000000000000000000000000000002e',
} as const

const initialHighStakeValidators: { [network in Networks]: string[] } = {
  mainnet: [
    '0x86652fE437425AC63211C55b6b067B3181BBcB17',
    '0xa505014a84e8BdC4A620470A53EAd872b0c1CA5b',
    '0xF5100e233E0A5AF82e9C6f3DEdF6Ca2E45099eF8',
    '0x4e5E774D3837bd9302B83CAD94a112575411F07B',
    '0x3C8075380217Eb85d4109226406cACda4c3BdB75',
    '0x9b64BE0ec5a334968b37BbD687EaDbc757DA6875',
    '0x3d821c7399ea97dA12e55727A378B4F5eb0289F8',
    '0xAf76F079631Ca0f3C090A98A2987b8D232C26447',
    '0xD47620F7904686E1B61bC2b16AD4Ef333623C3A4',
    '0xeC21628Fd017bbB0c751CB14BCbC6b81EB437241',
    '0x324D14607bB6853Fb0E15a02C80D59045714520F',
    '0x5F6831BDA9d0483054EB50A48966d65D2b156C7b',
    '0x6e28e5AF24dA4Cb7Bd669332244271eDce95f747',
    '0x5Ed4f15045aCfDd0392a7A0706503ae1aA2B82dc',
    '0x5646b6E8a0856766f0ace6D008f6919ad42Df82c',
    '0x025e6bEc8c34dBb38120840610004e8968790b7e',
    '0xB441A6A51BF69366d903c072D3B5594Ca02Ff1e0',
    '0x362EE93C00D8Bffc1e0284116d7CC9513cdE959F',
    '0x272d6bd040c2B8454f4f6F43115758fBe318ee2c',
    '0x80e358CBB533F6c8d07d2dc5604a55aA925A95df',
    '0xFCB42091aCBEf803e333A1b5C7079A43b0CFDE59',
    '0xaAF5a641256131484D00ACC565D84683025f2444',
    '0x18050B80d427B373C96AB24B78996310C0733c13',
  ],
  testnet: ['0xF886672205399c186638abfA9Dc155dEe9CBBD2e'],
}

const assertImmutableVariable = async (method: () => Promise<string>, expect: string) => {
  const actual = await method()
  if (actual !== expect) {
    throw new Error(`Variable mismatch, expect: ${expect}, actual: ${actual}`)
  }
}

const codeAndHash = async (hre: HRE, address: string): Promise<{ code: string; hash: string }> => {
  const code = await hre.ethers.provider.send('eth_getCode', [address, 'latest'])
  const hash = crypto
    .createHash('md5')
    .update(Buffer.from(code.slice(2), 'hex'))
    .digest('hex')
  return { code, hash }
}

const getStorageChanges = async (hre: HRE, txhash: string): Promise<Storage> => {
  const trace = (await hre.ethers.provider.send('debug_traceTransaction', [
    txhash,
    { disableMemory: true, disableStack: true },
  ])) as { structLogs: { storage: Storage }[] }

  const prefixed = {} as Storage
  Object.entries(trace.structLogs[trace.structLogs.length - 1].storage).forEach(
    ([slot, val]) => (prefixed['0x' + slot] = '0x' + val),
  )
  return prefixed
}

const mergeStorage = (src: Storage, appends: Storage): Storage => ({ ...src, ...appends })

task('output-candidate-manager').setAction(async (_, hre) => {
  // Deploy the AddressList.
  const addrListFactory = await hre.ethers.getContractFactory('AddressList')
  const addrList = await addrListFactory.deploy()

  // Deploy the CandidateValidatorManager.
  const candManagerFactory = await hre.ethers.getContractFactory('CandidateValidatorManager')
  const candManager = await candManagerFactory.deploy(
    PredeployContracts.Environment,
    PredeployContracts.StakeManager,
    PredeployContracts.CandidateValidatorManagerHighStakes,
  )
  await assertImmutableVariable(candManager.environment, PredeployContracts.Environment)
  await assertImmutableVariable(candManager.stakeManager, PredeployContracts.StakeManager)
  await assertImmutableVariable(candManager.highStakes, PredeployContracts.CandidateValidatorManagerHighStakes)

  // Construct the output.
  const addrListCodeHash = await codeAndHash(hre, addrList.address)
  const candMgrCodeHash = await codeAndHash(hre, candManager.address)
  const output: Output = {
    AddressList: {
      code: addrListCodeHash.code,
      hash: addrListCodeHash.hash,
      storage: {
        mainnet: {},
        testnet: {},
      },
    },
    CandidateValidatorManager: {
      code: candMgrCodeHash.code,
      hash: candMgrCodeHash.hash,
    },
  }

  // Get the storage layouts
  for (const [network, validators] of Object.entries(initialHighStakeValidators)) {
    const addrList = await addrListFactory.deploy()

    // Add the initial validators to the address list
    let tx = await addrList.adds(validators)
    let storage = mergeStorage({}, await getStorageChanges(hre, tx.hash))

    // Transfer ownership to the CandidateValidatorManager
    tx = await addrList.transferOwnership(PredeployContracts.CandidateValidatorManager)
    storage = mergeStorage(storage, await getStorageChanges(hre, tx.hash))

    output.AddressList.storage[network as Networks] = storage
  }

  console.log(JSON.stringify(output, null, 2))
})
