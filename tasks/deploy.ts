/* Imports: External */
import { task, subtask } from 'hardhat/config'

import { setCode } from "@nomicfoundation/hardhat-network-helpers";
import * as types from 'hardhat/internal/core/params/argumentTypes'
import { 
  STAKE_MANAGER_ADDRESS, 
  ENVIRONMENT_ADDRESS, 
  VALIDATOR_ALLOW_LIST_ADDRESS, 
  LOAS_ADDRESS, 
  SOAS_ADDRESS, 
  WOAS_ADDRESS,
  NFT_BRIDGE_MAINCHAIN_ADDRESS, 
  NFT_BRIDGE_RELAYER_ADDRESS, 
  NFT_BRIDGE_SIDECHAIN_ADDRESS, 
} from '../consts';

subtask('deploy:nft-bridge')
  .setAction(
    async (taskArgs, hre) => {
      console.log('Deploying NFT-Bridge Contract... ');
      const [signer] = await hre.ethers.getSigners();

      const bridgeMainChainFactory = await hre.ethers.getContractFactory('NFTBridgeMainchain');
      const bridgeSideChainFactory = await hre.ethers.getContractFactory('NFTBridgeSidechain');
      const relayerFactory = await hre.ethers.getContractFactory('NFTBridgeRelayer');

      const bridgeMainChain = await bridgeMainChainFactory.deploy();
      const bridgeSideChain = await bridgeSideChainFactory.deploy();

      await bridgeMainChain.deployed();
      await bridgeSideChain.deployed();

      const relayer = await relayerFactory.deploy(
        bridgeMainChain.address,
        bridgeSideChain.address,
        [signer.address],
        1
      );

      await relayer.deployed();

      const bridgeMainChainCode = await hre.network.provider.send("eth_getCode", [
        bridgeMainChain.address
      ]);
      const bridgeSideChainCode = await hre.network.provider.send("eth_getCode", [
        bridgeSideChain.address
      ]);
      const relayerCode = await hre.network.provider.send("eth_getCode", [
        relayer.address
      ]);
      await setCode(
        NFT_BRIDGE_MAINCHAIN_ADDRESS,
        bridgeMainChainCode
      );
      await setCode(
        NFT_BRIDGE_SIDECHAIN_ADDRESS,
        bridgeSideChainCode,
      );
      await setCode(
        NFT_BRIDGE_RELAYER_ADDRESS,
        relayerCode,
      );

      console.log(`bridgeMainChain is deployed to ${NFT_BRIDGE_MAINCHAIN_ADDRESS}`);
      console.log(`bridgeSideChain is deployed to ${NFT_BRIDGE_SIDECHAIN_ADDRESS}`);
      console.log(`relayer is deployed to ${NFT_BRIDGE_RELAYER_ADDRESS}`);
    }
  );

subtask('deploy:token')
   // set sOASTransferAllowListString as ArrayString(e.g. 'address1,address2,address3')
  .addParam(
    'sOASTransferAllowListString',
    'Address list that cat transferFrom sOAS',
    '',
    types.string
  )
  .setAction(
    async (
      taskArgs:
        {
          sOASTransferAllowListString: string;
        },
      hre
    ) => {
      console.log('Deploying Token Contract... ');
      const sOASTransferAllowList = taskArgs.sOASTransferAllowListString.split(',');

      const SOASFactory = await hre.ethers.getContractFactory('SOAS');
      const LOASFactory = await hre.ethers.getContractFactory('LOAS');
      const WOASFactory = await hre.ethers.getContractFactory('WOAS');

      const SOAS = await SOASFactory.deploy(sOASTransferAllowList);
      const LOAS = await LOASFactory.deploy();
      const WOAS = await WOASFactory.deploy();

      await SOAS.deployed();
      await LOAS.deployed();
      await WOAS.deployed();

      const SOASCode = await hre.network.provider.send("eth_getCode", [
        SOAS.address
      ]);
      const LOASCode = await hre.network.provider.send("eth_getCode", [
        LOAS.address
      ]);
      const WOASCode = await hre.network.provider.send("eth_getCode", [
        WOAS.address
      ]);
      await setCode(
        SOAS_ADDRESS,
        SOASCode,
      );
      await setCode(
        LOAS_ADDRESS,
        LOASCode,
      );
      await setCode(
        WOAS_ADDRESS,
        WOASCode,
      );

      console.log(`SOAS is deployed to ${SOAS_ADDRESS}`);
      console.log(`LOAS is deployed to ${LOAS_ADDRESS}`);
      console.log(`WOAS is deployed to ${WOAS_ADDRESS}`);
    }
  );
  
subtask('deploy:mainContract')
  .setAction(
    async (taskArgs, hre) => {
      console.log('Deploying Main Contract... ');

      const StakeManagerFactory = await hre.ethers.getContractFactory('StakeManager');
      const AllowlistFactory = await hre.ethers.getContractFactory('Allowlist');
      const EnvironmentFactory = await hre.ethers.getContractFactory('Environment');

      const StakeManager = await StakeManagerFactory.deploy();
      const Allowlist = await AllowlistFactory.deploy();
      const  Environment = await  EnvironmentFactory.deploy();

      await StakeManager.deployed();
      await Allowlist.deployed();
      await  Environment.deployed();

      const StakeManagerCode = await hre.network.provider.send("eth_getCode", [
        StakeManager.address
      ]);
      const AllowlistCode = await hre.network.provider.send("eth_getCode", [
        Allowlist.address
      ]);
      const EnvironmentCode = await hre.network.provider.send("eth_getCode", [
        Environment.address
      ]);
      await setCode(
        STAKE_MANAGER_ADDRESS,
        StakeManagerCode,
      );
      await setCode(
        VALIDATOR_ALLOW_LIST_ADDRESS,
        AllowlistCode,
      );
      await setCode(
        ENVIRONMENT_ADDRESS,
        EnvironmentCode,
      );

      console.log(`StakeManager is deployed to ${STAKE_MANAGER_ADDRESS}`);
      console.log(`Allowlist is deployed to ${VALIDATOR_ALLOW_LIST_ADDRESS}`);
      console.log(`Environment is deployed to ${ENVIRONMENT_ADDRESS}`);
    }
  );
  
task('deploy:local')
  .addParam(
    'l1BuildDeposit',
    'l1BuildDeposit_ADDRESS',
    '',
    types.string
  )
  .setAction(
    async (taskArgs:
      {
        l1BuildDeposit: string;
      },
      hre
    ) => {
      const sOASTransferAllowListString = [
        taskArgs.l1BuildDeposit
      ].join(',');
      await hre.run("deploy:nft-bridge");
      await hre.run("deploy:token", { sOASTransferAllowListString: sOASTransferAllowListString });
      await hre.run("deploy:mainContract");
    }
  );