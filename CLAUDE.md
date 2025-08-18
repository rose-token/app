# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rose Token is a decentralized Web3 marketplace with a token distribution model. The project consists of:
- Solidity smart contracts for the Ethereum blockchain
- React frontend for user interaction
- Three core roles: Customers (create tasks), Workers (complete tasks), Stakeholders (validate work)
- Token distribution: 60% worker, 20% stakeholder, 20% DAO treasury

## Development Commands

### Smart Contract Development
```bash
# Compile contracts
npm run compile

# Run all tests
npm test

# Run specific test file
npx hardhat test test/RoseMarketplace.test.js

# Deploy to local network
npx hardhat node  # Start local node first
npx hardhat run scripts/deploy.js --network localhost

# Deploy to Sepolia testnet
npm run deploy:sepolia

# Update contract ABIs in frontend after changes
npm run update-abi
```

### Frontend Development
```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm start

# Build for production
npm run build

# Run frontend tests
npm test
```

## Contract Architecture & Deployment Order

The smart contracts must be deployed in a specific sequence due to dependencies:

1. **RoseMarketplace** (deployed first)
   - Automatically deploys RoseToken and RoseReputation in its constructor
   - Central hub for task management
   - Handles token minting and distribution

2. **StakeholderRegistry** 
   - Requires RoseToken and RoseReputation addresses
   - Manages stakeholder registration and permissions

3. **RoseGovernance**
   - Requires RoseToken, RoseReputation, and RoseMarketplace addresses
   - Implements STAR voting system
   - Can create tasks using treasury funds

4. **TokenStaking**
   - Requires RoseToken, StakeholderRegistry, and DAO treasury addresses
   - Manages token staking for governance participation

5. **BidEvaluationManager**
   - Requires TokenStaking and RoseMarketplace addresses
   - Handles bidding logic for tasks

After deployment, contracts are linked via setter methods:
- `roseMarketplace.setStakeholderRegistry()`
- `roseMarketplace.setGovernanceContract()`
- `roseGovernance.setMarketplaceTokenStaking()`
- `roseGovernance.setMarketplaceBidEvaluationManager()`
- `stakeholderRegistry.authorizeContract(marketplaceAddress)`

## Key Contract Interactions

### Task Lifecycle
1. Customer creates task with ETH deposit → RoseMarketplace
2. Worker claims task → RoseMarketplace checks StakeholderRegistry
3. Worker completes task → RoseMarketplace
4. Stakeholder approves → RoseMarketplace mints tokens via RoseToken
5. Tokens distributed: 60% worker, 20% stakeholder, 20% DAO

### Governance Flow
1. Users stake tokens → TokenStaking
2. Proposals created → RoseGovernance
3. STAR voting occurs → RoseGovernance
4. Approved proposals can create tasks → RoseMarketplace

## Frontend Architecture

The frontend uses React with custom webpack configuration (via react-app-rewired) to handle Web3 dependencies:

- **Components**: Organized by feature (governance/, marketplace/, wallet/, bugs/)
- **Hooks**: Custom React hooks for contract interaction (useContract, useEthereum)
- **Contract ABIs**: Located in frontend/src/contracts/
- **MetaMask Integration**: Uses @metamask/sdk-react
- **IPFS Integration**: Uses Pinata for decentralized storage

## Testing Approach

Tests cover critical functionality:
- Token minting and distribution
- Task lifecycle (creation, claiming, completion, approval)
- Governance voting mechanisms
- Staking and unstaking
- Bidding system
- Refund mechanisms
- Edge cases and security

Run individual test suites:
```bash
npx hardhat test test/RoseToken.test.js
npx hardhat test test/RoseGovernance.test.js
npx hardhat test test/TokenStaking.test.js
```

## Environment Variables

Create `.env` file in root:
```
SEPOLIA_RPC_URL=your_rpc_url
PRIVATE_KEY=your_private_key
DAO_TREASURY_ADDRESS=treasury_address
ETHERSCAN_API_KEY=your_api_key
```

Create `.env` in frontend/:
```
REACT_APP_MARKETPLACE_ADDRESS=deployed_marketplace_address
REACT_APP_TOKEN_ADDRESS=deployed_token_address
```

## Contract Addresses Management

After deployment:
1. `deployment-output.json` is created with all contract addresses
2. Run `npm run update-abi` to copy ABIs to frontend
3. Update frontend `.env` with deployed addresses

## Network Configuration

- **Local**: Hardhat node on localhost:8545 (chainId: 1337)
- **Testnet**: Sepolia (chainId: 11155111)
- **Frontend**: Configured for Sepolia by default

## Solidity Optimizer Settings

The project uses aggressive optimization for gas efficiency:
- Optimizer enabled with 1 run
- `viaIR: true` for additional optimizations
- Impacts deployment costs but reduces transaction costs

## MANDATORY: Git Workflow & CI/CD Monitoring

**IMPORTANT**: You MUST follow these workflows for ALL code changes:

### 1. Branch Creation & Development
```bash
# ALWAYS create a new feature branch for changes
git checkout -b feature/descriptive-branch-name

# Make your changes and commit them
git add .
git commit -m "feat: descriptive commit message"

# Push the branch
git push -u origin feature/descriptive-branch-name
```

### 2. Pull Request Creation
After pushing your branch, you MUST:
```bash
# Create a pull request using GitHub CLI
gh pr create --title "feat: your feature title" --body "Description of changes"
```

### 3. CI/CD Pipeline Monitoring
**CRITICAL**: After creating a PR, you MUST continuously monitor the CI/CD pipeline:

```bash
# Watch PR checks status
gh pr checks --watch

# If using web interface, monitor at:
# https://github.com/[owner]/rose-token/pull/[PR-number]/checks
```

### 4. CI/CD Failure Response Protocol
If CI/CD checks fail, you MUST:

1. **Fetch the failure logs immediately**:
```bash
# Get workflow run details
gh run list --limit 5
gh run view [run-id]

# Download logs for failed jobs
gh run download [run-id]
```

2. **Analyze and fix the failure**:
   - Read error messages carefully
   - Identify the failing test or build step
   - Fix the issue in your feature branch
   - Commit and push the fix

3. **Continue monitoring until all checks pass**:
```bash
# After pushing fixes
git add .
git commit -m "fix: resolve CI/CD failure - [specific issue]"
git push

# Resume monitoring
gh pr checks --watch
```

### 5. PR Build Workflow Details
The project has two main CI/CD jobs that MUST pass:

- **build-contracts**: Runs contract tests, compilation, and Sepolia deployment
- **build-frontend**: Builds the React application with ABI updates

Common failure points to watch for:
- Contract test failures (check test output)
- Missing environment variables (ensure secrets are configured)
- Frontend build errors (check for TypeScript/ESLint issues)
- ABI generation failures (ensure contracts compile first)

### 6. Workflow Commands Reference
```bash
# Check PR status
gh pr status

# View specific PR checks
gh pr checks [PR-number]

# View workflow runs
gh workflow list
gh workflow view pr-build.yml

# Re-run failed checks
gh run rerun [run-id]

# View PR in browser for detailed CI/CD status
gh pr view --web
```

**NEVER**:
- Push directly to main branch
- Merge a PR with failing CI/CD checks
- Ignore CI/CD failures
- Skip the monitoring step after creating a PR

**ALWAYS**:
- Create a feature branch for changes
- Create a pull request for review
- Monitor CI/CD pipeline until completion
- Fix any failures immediately and re-monitor
- Only merge after all checks pass