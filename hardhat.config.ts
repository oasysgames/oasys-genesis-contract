import { HardhatUserConfig } from 'hardhat/types'
import { ethers } from 'ethers'
import '@nomicfoundation/hardhat-toolbox'
import '@nomiclabs/hardhat-waffle'
import 'solidity-coverage'

import './tasks/output-candidate-manager'
import './tasks/output-slash-indicator'
import './tasks/update-bls'

const DEPLOYER_KEY: string = process.env.DEPLOYER_KEY ||
 "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"; // Dumy key

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.5.17',
        settings: {
          // viaIR: true,
          optimizer: { enabled: true, runs: 200 }
        },
      },
      {
        version: '0.8.12',
        settings: {
          // viaIR: true,
          optimizer: { enabled: true, runs: 200 }
        },
      },
    ],
  },
  networks: {
    hardhat: {
      initialBaseFeePerGas: 0,
      gasPrice: 0,
      // Don't worry about the contract size limit.
      // Instead of deploying these contracts, we embed the bytecode directly into storage.
      allowUnlimitedContractSize: true,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      accounts: [DEPLOYER_KEY],
      gasPrice: 1500000000 // 1.5 gwei
    },
  },
  mocha: {
    timeout: 1000 * 60 * 3, // 3 minutes
  },
}

export default config
