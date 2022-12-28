# oasys-genesis-contract

Genesis Smart Contracts for Oasys Blockchain.

## Install dependencies

```shell
npm install
```

## Build contracts

```shell
npm run build
```

## Run tests

```shell
npm run test
```

# Setup(localhost oasys-hub-layer)
This setup is for developers of [oasys-genesis-contract](https://github.com/oasysgames/oasys-genesis-contract) and oasys-optimism's [oasys-contract](https://github.com/oasysgames/oasys-optimism/tree/develop/packages/contracts).

## Build node
```shell
npx hardhat node
```

## Deploy optimism L1 contracts
Move to oasys-optimism's [oasys-contract](https://github.com/oasysgames/oasys-optimism/tree/develop/packages/contracts).
You set that node version is 15.

```shell
npm install
npx hardhat run scripts/generate-artifacts.ts

npx hardhat --network localhost deploy:L1:local
```

## Deploy contracts of oasys-genesis-contract
Move to [oasys-genesis-contract](https://github.com/oasysgames/oasys-genesis-contract).

```shell
# set address deployed with optimism L1 contracts
npx hardhat --network localhost deploy:local --l1-build-deposit `YOUR l1BuildDepositAddress`
```

## Build Verse
According to the following page, please build verse.

[Manual for Building Verse](https://docs.oasys.games/docs/verse-developer/how-to-build-verse/1-2-manual).

You can build web page at local to build verse with [oasys-pos-fe](https://github.com/oasysgames/oasys-pos-fe).
```shell
git clone git@github.com:oasysgames/oasys-pos-fe.git
yarn
yarn dev
```

When building verse, You have to set verse to access to Local Oasys L1.

Set environment variable at [verse-layer-optimism](https://github.com/oasysgames/verse-layer-optimism)

```shell
# .env
L1_CHAIN_ID=31337
L1_HTTP_URL=http://host.docker.internal:8545

# Port you want to use at verse
L2GETH_HTTP_PORT=8000
```

## Deploy optimism L2 contracts(optional)
If you want to deploy L2 contract, execute following.

### Modify hardhat config
To deploy to local verse, you have to modify hardhat config.
Because local L1 is using 8545 port.

```typescript
networks: {
  ...
  localVerse: {
    // set port you want to use at verse
    url: 'http://127.0.0.1:8000',
    saveDeployments: false,
  },
  ...
}
```

### Command
```shell
npx hardhat --network localVerse deploy:L2:messaging
npx hardhat --network localVerse deploy:L2:token
```

These use case is following
- create oNFT that can bridge between L1 and L2
