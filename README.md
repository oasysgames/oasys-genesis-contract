# oasys-genesis-contract

Genesis Smart Contracts for Oasys Blockchain.

## Install dependencies

```shell
npm install
```

## Build contracts

```
npm run build
```

## Run tests

Before running the test, comment out the `onlyCoinbase` modifier in `contracts/System.sol` like this.

```solidity:contracts/System.sol
modifier onlyCoinbase() {
    // require(msg.sender == block.coinbase, "sender must be block producer.");
    _;
}
```

Run tests.
```shell
npm run test
```