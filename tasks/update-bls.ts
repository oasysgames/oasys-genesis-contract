import { task } from 'hardhat/config'

const StakeManagerAddress =  '0x0000000000000000000000000000000000001001'
const BLS_KEY: string = process.env.BLS_KEY || '0x'

export const assertBLSKey = (data: string): string => {
  if (!data.startsWith('0x')) {
    throw new Error(`Account ${data} does not start with '0x'`);
  }
  if (data.length != 96 + 2) {
    throw new Error(`Account ${data} is not 96 bytes long`);
  }
  return data;
};

task('update-bls', 'Call updateBLSPublicKey function of StakeManager')
  .addParam('key', 'The BLS public key to update', BLS_KEY, undefined)
  .setAction(async (taskArgs, hre) => {
    const { ethers } = hre;
    const signers = await ethers.getSigners();
    const validatorOwner = signers[0].address;
    const blsKey: string = assertBLSKey(taskArgs.key);
    const stakeManager = await ethers.getContractAt('StakeManager', StakeManagerAddress)
    const balance = await ethers.provider.getBalance(validatorOwner)

    console.log(`Validator Owner address: ${validatorOwner}`)
    console.log(`Balance of owner key: ${balance}`)
    console.log(`Updating BLS key to ${blsKey}`)
    console.log(`...`)

    // Send the transaction
    const tx = await stakeManager.updateBLSPublicKey(blsKey)
    await tx.wait(2);

    // Confirm the updated key
    const info = await stakeManager.getValidatorInfo(validatorOwner, 0)
    console.log(`Updated BLS key: ${info.blsPublicKey}`);
  });
