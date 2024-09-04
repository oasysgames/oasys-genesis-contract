import { HardhatUserConfig } from 'hardhat/types'
import '@nomicfoundation/hardhat-toolbox'
import '@nomiclabs/hardhat-waffle'
import 'solidity-coverage'

import './tasks/output-candidate-manager'

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
  },
  mocha: {
    timeout: 1000 * 60 * 3, // 3 minutes
  },
}

export default config
