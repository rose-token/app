# Rose Token - Decentralized Task Marketplace

A worker-focused decentralized marketplace with task-value-based token distribution, built on Ethereum using Solidity and React.

![License](https://img.shields.io/badge/license-PPL-blue.svg)
![Solidity](https://img.shields.io/badge/solidity-0.8.17-purple.svg)
![Network](https://img.shields.io/badge/network-Sepolia-orange.svg)

## Overview

Rose Token is a decentralized Web3 marketplace that connects customers with workers through a transparent, blockchain-based task completion system. The platform uses a task-value-based token distribution model that prioritizes worker compensation while maintaining quality through stakeholder validation.

### Core Roles

- **Customers**: Create tasks and deposit ROSE tokens as payment
- **Workers**: Claim and complete tasks to earn ROSE tokens
- **Stakeholders**: Validate completed work by staking ROSE tokens

### Tokenomics Model

The platform implements a **worker-focused tokenomics model** introduced in November 2024:

**For a 10 ROSE task:**
- Customer deposits: **10 ROSE** (escrowed in marketplace contract)
- Stakeholder stakes: **1 ROSE** (10% of task value, returned on completion)
- Platform mints: **0.2 ROSE** → DAO treasury (2% of task value, creates ~2% annual inflation)

**Distribution on completion:**
- **Worker receives**: 9.5 ROSE (95% of customer deposit)
- **Stakeholder receives**: 1.5 ROSE total (1.0 stake returned + 0.5 fee = 50% ROI)
- **DAO receives**: 0.2 ROSE (minted separately, not from distribution pot)

**Key Features:**
- Task-value-based distribution (no fixed base reward)
- 95% of customer payment goes directly to workers
- Stakeholders earn 50% ROI on their 10% stake
- Platform mints only 2% of task value to DAO (sustainable inflation)
- All three roles must be held by different addresses per task (prevents self-dealing)

## Smart Contracts

The platform consists of **2 core smart contracts**:

### 1. RoseMarketplace (331 lines)
The central hub for task management and token distribution.

**Key Features:**
- Automatically deploys RoseToken in constructor
- Funds DAO treasury with 10,000 ROSE on deployment
- Manages complete task lifecycle with 6 statuses
- Handles ROSE token escrow and distribution
- Enforces strict role separation (customer ≠ stakeholder ≠ worker)
- Integrates with IPFS for detailed task descriptions

**Task Status Flow:**
```
StakeholderRequired → Open → InProgress → Completed → ApprovedPendingPayment → Closed
     ↓                 ↓
     └─────────────────┴──→ (cancelTask) → Closed (with refunds)
```

### 2. RoseToken (94 lines)
ERC20 token with controlled minting.

**Specifications:**
- Name: "Rose Token"
- Symbol: "ROSE"
- Decimals: 18
- Minting: Restricted to RoseMarketplace contract only
- Standard: Full ERC20 implementation (transfer, approve, transferFrom)

## Task Lifecycle

### 1. Task Creation (Status: StakeholderRequired)
Customer creates task with:
- **Short title**: Max 100 characters (on-chain)
- **IPFS hash**: Detailed description stored on IPFS (privacy-protected)
- **Token amount**: Payment in ROSE tokens (escrowed)

```javascript
await marketplace.createTask(
  "Build landing page",
  "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
  ethers.utils.parseEther("10")
);
```

### 2. Stakeholder Stakes (Status: Open)
Stakeholder deposits exactly 10% of task value to validate future work:

```javascript
await marketplace.stakeholderStake(taskId);
// Requires prior approval for 10% of task value
```

### 3. Worker Claims (Status: InProgress)
Worker claims task on first-come, first-served basis:

```javascript
await marketplace.claimTask(taskId);
```

**Worker Unclaim Feature** (Added October 2025):
Workers can unclaim tasks they cannot complete:

```javascript
await marketplace.unclaimTask(taskId);
// Task reverts to Open status for another worker
```

### 4. Worker Completes (Status: Completed)
Worker marks task as completed:

```javascript
await marketplace.markTaskCompleted(taskId);
```

### 5. Approval Process (Status: ApprovedPendingPayment)
Both customer and stakeholder must approve (order doesn't matter):

```javascript
await marketplace.approveCompletionByCustomer(taskId);
await marketplace.approveCompletionByStakeholder(taskId);
```

### 6. Payment Distribution (Status: Closed)
Worker accepts payment, triggering automatic distribution:

```javascript
await marketplace.acceptPayment(taskId);
// Distributes: 95% to worker, 5% fee + stake to stakeholder
// Mints: 2% to DAO treasury
```

### Cancellation (Alternative Flow)
Tasks can be cancelled before worker claims:

**From StakeholderRequired:**
- Customer can cancel and receive full refund

**From Open:**
- Customer OR stakeholder can cancel
- Both receive full refunds (deposit + stake)

**Restrictions:**
- Cannot cancel after worker claims (InProgress or later)
- Emits `TaskCancelled` event with refund amounts

## IPFS Integration

Task descriptions are stored on IPFS via Pinata for privacy and gas efficiency:

**Benefits:**
- Reduces on-chain storage costs
- Enables rich formatting (markdown, structured data)
- Privacy-protected (only task participants can view details)
- Immutable task specifications

**Privacy Enforcement:**
- Frontend checks `isTaskParticipant(taskId)` before fetching
- Only customer, stakeholder, and worker can view detailed descriptions
- Non-participants see privacy notice
- IPFS content public but hash not discoverable without contract access

## Frontend Application

React 18.2.0 application with MetaMask integration and responsive UI.

### Pages
- **TasksPage**: Main marketplace with filtering, sorting, and task management
- **ProfilePage**: User profile and role management
- **HelpPage**: Documentation and bug reporting

### Key Components

**Marketplace:**
- `TaskList.jsx` - Task display with filtering/sorting
- `TaskCard.jsx` - Individual task cards with status-based actions
- `TaskFilters.jsx` - Filter by status and role
- `TokenDistributionChart.jsx` - Visual 95/5 split representation
- `ProgressTracker.jsx` - Task progress for participants

**Wallet:**
- `TokenBalance.jsx` - ROSE balance display
- `NetworkSelector.jsx` - Sepolia network switching
- `WalletNotConnected.jsx` - MetaMask connection prompts

### Custom Hooks
- `useEthereum.js` - MetaMask connection and account management
- `useContract.js` - Contract initialization and method calls
- `useNotifications.js` - Toast notification system
- `useProfile.js` - User profile state

### Theme & Styling

The application uses a **soft red rose color palette** with centralized CSS variables:

**Core Colors:**
- Deep Rose (`#B1452C`) - Primary brand color, buttons, navbar
- Warm Peach (`#E4A97F`) - Positive actions, success states
- Dark Brown (`#421F16`) - Destructive actions, warnings
- Medium Brown (`#755947`) - Secondary elements, borders
- Cream Background (`#F6E8D5`) - Page and card backgrounds

**Styling Best Practices:**
- All colors defined as CSS variables in `frontend/src/index.css`
- Semantic naming (e.g., `bg-primary`, `text-accent`, `bg-task-claim`)
- Tailwind CSS integration via `tailwind.config.js`
- Dark mode support built-in
- Single source of truth for theme management

## Development Setup

### Prerequisites
- Node.js 18.x or higher
- MetaMask wallet extension
- Sepolia testnet ETH (for deployment)
- Pinata account (for IPFS integration)

### Smart Contract Development

```bash
# Install dependencies
npm install

# Compile contracts
npm run compile

# Run all tests (5 test suites, ~626 lines)
npm test

# Run specific test file
npx hardhat test test/RoseMarketplace.test.js
npx hardhat test test/RoseToken.test.js
npx hardhat test test/TaskLifecycleEdgeCases.test.js
npx hardhat test test/DetailedDescription.test.js

# Start local Hardhat node
npx hardhat node

# Deploy to local network
npx hardhat run scripts/deploy.js --network localhost

# Deploy to Sepolia testnet
npm run deploy:sepolia

# Update contract ABIs in frontend
npm run update-abi
```

### Frontend Development

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start development server (http://localhost:3000)
npm start

# Build for production
npm run build

# Run frontend tests
npm test
```

## Environment Configuration

### Root Directory `.env`
Required for contract deployment:

```bash
# Sepolia RPC endpoint
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID

# Deployer wallet private key (without 0x prefix)
PRIVATE_KEY=your_wallet_private_key

# DAO treasury address
DAO_TREASURY_ADDRESS=0x_treasury_address

# Etherscan API key (for contract verification)
ETHERSCAN_API_KEY=your_etherscan_api_key
```

### Frontend `.env`
Required for frontend application:

```bash
# Deployed contract addresses (from deployment-output.json)
REACT_APP_MARKETPLACE_ADDRESS=0x_deployed_marketplace_address
REACT_APP_TOKEN_ADDRESS=0x_deployed_token_address

# Optional: Custom RPC URL (defaults to MetaMask provider)
REACT_APP_ETHEREUM_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID

# Pinata IPFS credentials
REACT_APP_PINATA_API_KEY=your_pinata_api_key
REACT_APP_PINATA_SECRET_API_KEY=your_pinata_secret_key
REACT_APP_PINATA_JWT=your_pinata_jwt_token
```

Use `frontend/.env.example` as a template.

## Testing

The project includes **5 comprehensive test suites** covering ~626 lines:

| Test Suite | Lines | Coverage |
|------------|-------|----------|
| `RoseMarketplace.test.js` | 228 | Task lifecycle, payments, escrow |
| `RoseToken.test.js` | 130 | Minting, transfers, approvals |
| `TaskLifecycleEdgeCases.test.js` | 123 | Edge cases, error conditions |
| `DetailedDescription.test.js` | 74 | IPFS integration, privacy |
| *(Worker Unclaim Tests)* | 71 | Unclaim functionality, re-claiming |

**Test Coverage:**
- ✅ Complete task lifecycle from creation to payment
- ✅ Token minting and distribution (95/5 split + 2% DAO)
- ✅ Worker unclaim and re-claim scenarios
- ✅ Role separation enforcement
- ✅ Invalid state transitions
- ✅ Unauthorized access attempts
- ✅ Edge cases and error conditions

```bash
# Run all tests
npm test

# Run with gas reporting
npx hardhat test --network hardhat
```

## CI/CD Workflows

The project uses **GitHub Actions** with 2 automated workflows:

### 1. PR Build Workflow (`pr-build.yml`)
Runs on all pull requests with **parallel jobs**:

**build-contracts job:**
- Install dependencies (`npm ci`)
- Run all tests (`npx hardhat test`)
- Compile contracts (`npx hardhat compile`)
- Generate ABIs (`node scripts/update-abi.js`)

**build-frontend job:**
- Install dependencies (root + frontend)
- Compile contracts and update ABIs
- Build frontend with placeholder addresses
- Validate build succeeds

### 2. Combined Deploy Workflow (`combined-deploy.yml`)
Runs on main branch pushes and manual triggers:

**deploy-contracts job:**
- Run tests and compile
- Deploy to Sepolia testnet
- Wait 90 seconds for contract propagation
- Verify on Etherscan (API v2)
- Save deployment addresses as artifact

**deploy-frontend job:**
- Download contract addresses
- Update ABIs with real addresses
- Build frontend
- Deploy to GitHub Pages

**Required GitHub Secrets:**
- `SEPOLIA_RPC_URL`
- `PRIVATE_KEY`
- `DAO_TREASURY_ADDRESS`
- `ETHERSCAN_API_KEY`
- `REACT_APP_PINATA_API_KEY`
- `REACT_APP_PINATA_SECRET_API_KEY`
- `REACT_APP_PINATA_JWT`

## Deployment

### Contract Deployment Order

1. **RoseMarketplace** deploys first
2. RoseMarketplace constructor automatically deploys **RoseToken**
3. DAO treasury funded with 10,000 ROSE on deployment
4. Deployment creates `deployment-output.json` with addresses

```bash
# Deploy to Sepolia
npm run deploy:sepolia

# Output includes:
# - Deployer's ETH balance (before/after)
# - Total gas costs
# - All contract addresses
```

### Post-Deployment Steps

1. Copy contract addresses from `deployment-output.json`
2. Update `frontend/.env` with addresses
3. Run `npm run update-abi` to sync ABIs to frontend
4. Deploy frontend or test locally

## Network Configuration

**Supported Networks:**
- **Local Development**: Hardhat node (localhost:8545, chainId: 1337)
- **Testnet**: Sepolia (chainId: 11155111)
- **Frontend Default**: Sepolia

**Gas Optimization:**
- Optimizer enabled with 1 run
- `viaIR: true` for additional optimizations
- Prioritizes lower transaction costs over deployment costs

## Security Features

### Role Separation Enforcement

The marketplace enforces strict role separation to prevent conflicts of interest:

**Enforced Rules:**
1. Customer ≠ Stakeholder (prevents self-validation)
2. Customer ≠ Worker (prevents self-payment)
3. Stakeholder ≠ Worker (prevents validating own work)

**Error Messages:**
- "Customer cannot be stakeholder for their own task"
- "Customer cannot claim their own task"
- "Stakeholder cannot claim task they are validating"
- "Worker cannot be stakeholder for their own task"

**Frontend Validation:**
- Pre-checks before transaction submission
- Disabled buttons for invalid actions
- User-friendly error messages

**Security Benefits:**
- Prevents self-dealing
- Maintains validation integrity
- Ensures fairness across all participants
- Protects tokenomics model

## Project History

### November 2024: New Tokenomics Model
- Implemented task-value-based distribution
- Changed split to 95% worker, 5% stakeholder fee
- Added 2% platform minting to DAO treasury
- Removed fixed base reward system
- Stakeholder stake requirement: 10% of task value
- Stakeholder ROI: 50% on stake (5% fee + stake returned)

### October 2025: Worker Unclaim Feature
- Added `unclaimTask()` function
- Workers can release tasks they cannot complete
- Task reverts to Open status for re-claiming
- Prevents tasks from being stuck indefinitely
- No financial penalty for honest unclaims

### October 2024: MVP Simplification
- Removed competitive bidding system
- Removed multi-stakeholder approval workflow
- Removed comments and dispute resolution
- Removed PGP encryption features
- Removed RoseReputation contract
- Removed BidEvaluationManager contract
- Removed TokenStaking and StakeholderRegistry contracts
- Removed governance layer (RoseGovernance contract)
- Simplified to 2 core contracts
- Focus on direct task creation and completion

## Architecture Philosophy

The project follows a **"Progressive Enhancement"** approach:

**Current Phase - MVP:**
- ✅ Simple task creation with ROSE deposits
- ✅ First-come, first-served worker claiming
- ✅ Single-stakeholder validation
- ✅ Direct payment distribution
- ✅ Worker unclaim functionality
- ✅ IPFS integration for privacy

**Future Enhancements:**
- 🔮 Competitive bidding and worker selection
- 🔮 Multi-stakeholder validation
- 🔮 On-chain commenting system
- 🔮 Dispute resolution mechanisms
- 🔮 Advanced refund logic
- 🔮 Reputation tracking system
- 🔮 Governance proposals

## Key Metrics

- **Smart Contracts**: 2 (RoseMarketplace, RoseToken)
- **Test Suites**: 5 (~626 total lines)
- **Frontend Pages**: 3 (Tasks, Profile, Help)
- **Custom Hooks**: 5 (Ethereum, Contract, Notifications, Profile)
- **Worker Share**: 95% of customer deposit
- **Stakeholder Fee**: 5% of customer deposit
- **Stakeholder Stake**: 10% of task value (returned on completion)
- **Stakeholder ROI**: 50% (5% fee on 10% stake)
- **Platform Mint**: 2% of task value → DAO treasury
- **Annual Inflation**: ~2% (from platform minting)
- **CI/CD Workflows**: 2 (PR Build, Combined Deploy)

## Technology Stack

**Smart Contracts:**
- Solidity 0.8.17
- Hardhat development framework
- Ethers.js v5.7.2
- Chai testing library

**Frontend:**
- React 18.2.0
- React Router v6
- Tailwind CSS
- Radix UI components
- @tanstack/react-query 4.36.1
- DOMPurify 3.2.6 (XSS protection)
- Recharts 2.15.3 (data visualization)

**Web3 Integration:**
- @metamask/sdk-react 0.32.1
- ethers.js 5.7.2
- react-app-rewired (webpack customization)

**IPFS:**
- @pinata/sdk 2.1.0
- Pinata Cloud service

**Network:**
- Sepolia testnet (chainId: 11155111)

## Contributing

### Git Workflow

1. Create feature branch:
   ```bash
   git checkout -b feature/descriptive-name
   ```

2. Make changes and commit:
   ```bash
   git add .
   git commit -m "feat: descriptive message"
   ```

3. Push branch:
   ```bash
   git push -u origin feature/descriptive-name
   ```

4. Create pull request:
   ```bash
   gh pr create --title "feat: your feature" --body "Description"
   ```

5. Monitor CI/CD:
   ```bash
   gh pr checks --watch
   ```

**Important:**
- All PRs must pass CI/CD checks before merging
- Never push directly to main branch
- Fix CI/CD failures immediately
- Follow semantic commit messages

### Development Best Practices

1. **Read Before Modifying**: Always read existing code before making changes
2. **Test Coverage**: Ensure all tests pass (`npm test`)
3. **ABI Sync**: Run `npm run update-abi` after contract changes
4. **No Over-Engineering**: Keep solutions simple and focused
5. **Security First**: Watch for vulnerabilities (XSS, injection, OWASP top 10)
6. **Gas Optimization**: Consider gas costs in contract changes
7. **MVP Scope**: Don't reference removed features

## Resources

- **Hardhat**: https://hardhat.org/docs
- **Ethers.js v5**: https://docs.ethers.org/v5/
- **React Router v6**: https://reactrouter.com/
- **Tailwind CSS**: https://tailwindcss.com/docs
- **Radix UI**: https://www.radix-ui.com/
- **Pinata IPFS**: https://docs.pinata.cloud/
- **MetaMask SDK**: https://docs.metamask.io/wallet/how-to/use-sdk/

## License

This project is licensed under the Polyform Perimeter License (PPL).

## Support

For issues, questions, or contributions:
- **GitHub Issues**: https://github.com/emmadorably/rose-token/issues
- **Documentation**: See `CLAUDE.md` for detailed project guidance

---

**Last Updated**: November 2024
**Solidity Version**: 0.8.17
**Node Version**: 18.x
**Network**: Sepolia (chainId: 11155111)
**Status**: MVP - Production Ready
