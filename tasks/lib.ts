import * as crypto from 'crypto'
import type { HardhatRuntimeEnvironment as HRE } from 'hardhat/types'

export type Networks = 'mainnet' | 'testnet' | 'localnet'

export type Storage = { [slot: string]: string }

export const Chains: { [network in Networks]: { chainID: number } } = {
  mainnet: { chainID: 248 },
  testnet: { chainID: 9372 },
  localnet: { chainID: 12345 },
} as const

export const PredeployContracts = {
  Environment: '0x0000000000000000000000000000000000001000',
  StakeManager: '0x0000000000000000000000000000000000001001',
  CandidateValidatorManagerHighStakes: '0x520000000000000000000000000000000000002D',
  CandidateValidatorManager: '0x520000000000000000000000000000000000002e',
} as const

export const assertImmutableVariable = async (method: () => Promise<any>, expect: any) => {
  const actual = await method()
  if (actual !== expect) {
    throw new Error(`Variable mismatch, expect: ${expect}, actual: ${actual}`)
  }
}

export const codeAndHash = async (hre: HRE, address: string): Promise<{ code: string; hash: string }> => {
  const code = await hre.ethers.provider.send('eth_getCode', [address, 'latest'])
  const hash = crypto
    .createHash('md5')
    .update(Buffer.from(code.slice(2), 'hex'))
    .digest('hex')
  return { code, hash }
}

export const getStorageChanges = async (hre: HRE, txhash: string): Promise<Storage> => {
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

export const mergeStorage = (src: Storage, appends: Storage): Storage => ({ ...src, ...appends })
