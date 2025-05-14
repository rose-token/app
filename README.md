# Socialist Crypto Token Model

A decentralized marketplace with a socialist token distribution model, built on Ethereum using Solidity.

## Overview

This project implements a decentralized task marketplace with three core roles:
- **Customers**: Create tasks with ETH deposits
- **Workers**: Claim and complete tasks
- **Stakeholders**: Validate work and arbitrate disputes

When tasks are completed successfully, new ROSE tokens are minted and distributed:
- 50% to the worker who completed the task
- 20% to the stakeholder who validated the work
- 20% to a DAO treasury for community governance
- 10% burned to control inflation

## Contracts

- **RoseToken**: A custom ERC20 token with controlled minting
- **RoseMarketplace**: A decentralized task marketplace with task lifecycle management and token distribution

## Development

```shell
# Install dependencies
npm install

# Run tests
npx hardhat test

# Start local node
npx hardhat node

# Deploy to local network
npx hardhat run scripts/deploy.js --network localhost

# Deploy to Sepolia testnet (requires .env configuration)
npx hardhat run scripts/deploy.js --network sepolia
```

## License

MIT
