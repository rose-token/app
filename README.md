# Worker-Focused Crypto Token Model

A decentralized marketplace with a worker token distribution model, built on Ethereum using Solidity.

## Overview

This project implements a decentralized task marketplace with three core roles:
- **Customers**: Create tasks with ETH deposits
- **Workers**: Claim and complete tasks
- **Stakeholders**: Validate work and arbitrate disputes

When tasks are completed successfully, new ROSE tokens are minted and distributed:
- 60% to the worker who completed the task
- 20% to the stakeholder who validated the work
- 20% to a DAO treasury for community governance

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

## Frontend

The Rose Token frontend is a React application that provides a user interface for interacting with the Rose Token marketplace on the Sepolia testnet.

### Setup

1. Navigate to the frontend directory:
   ```
   cd frontend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file with your contract addresses (see `.env.example`):
   ```
   REACT_APP_MARKETPLACE_ADDRESS=your_marketplace_address
   REACT_APP_TOKEN_ADDRESS=your_token_address
   ```

4. Start the development server:
   ```
   npm start
   ```

### Features

- Wallet connection with MetaMask
- Task creation with ETH deposits
- Task claiming, completion, and approval workflows
- Dispute resolution
- Token balance display
- Worker token distribution visualization
