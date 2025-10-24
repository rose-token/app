# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## IMPORTANT: Subagent Usage Policy

**ALWAYS use subagents (Task tool) whenever possible** to maximize efficiency and reduce context usage:

### When to Use Subagents:
- **File Search Operations**: Use general-purpose agent for searching across multiple files, understanding codebase structure, or finding specific implementations
- **Complex Multi-Step Tasks**: Delegate research, analysis, and implementation steps to subagents
- **Open-Ended Exploration**: When you need to understand how something works in the codebase before making changes
- **Parallel Operations**: Launch multiple subagents concurrently for independent tasks
- **Pattern Matching**: Use subagents for finding all occurrences of patterns, similar code, or related functionality

### Subagent Best Practices:
1. **Be Specific**: Provide detailed instructions about what the subagent should find and return
2. **Use Concurrently**: Launch multiple subagents in parallel when tasks are independent
3. **Trust Results**: Subagent outputs should generally be trusted and acted upon
4. **Reduce Context**: Prefer subagents over multiple direct tool calls for complex searches

### Example Usage Patterns:
- "Find all files that import X and understand how they use it" → Use general-purpose agent
- "Search for error handling patterns in the codebase" → Use general-purpose agent
- "Understand the authentication flow" → Use general-purpose agent
- "Find and analyze all test files for component Y" → Use general-purpose agent

**Remember**: Subagents are stateless - provide complete instructions in a single prompt as you cannot send follow-up messages.

## Project Overview

Rose Token is a decentralized Web3 marketplace with a token distribution model. The project consists of:
- Solidity smart contracts for the Ethereum blockchain (7 contracts)
- React frontend for user interaction
- Three core roles: Customers (create tasks), Workers (complete tasks), Stakeholders (validate work)
- Token distribution: 60% worker, 20% stakeholder, 20% DAO treasury
- Base reward: 100 ROSE tokens per completed task

### MVP Status (October 2024)
The project is currently in **MVP (Minimum Viable Product)** mode. Complex features have been removed to focus on core functionality:

**REMOVED FEATURES** (as of commit f81f4e3):
- Competitive bidding system (placeBid, selectShortlist, finalizeWorkerSelection)
- Multi-stakeholder approval workflow
- Comments system (addComment, getTaskComments)
- Dispute resolution mechanisms
- Complex refund logic
- PGP key storage and encryption

**CURRENT MVP FEATURES**:
- Simple task creation with ETH deposits
- Single-stakeholder validation model
- Direct worker claiming (first-come, first-served)
- Straightforward approval and payment flow
- STAR voting governance
- Token staking for stakeholder elections

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

1. **RoseMarketplace** (459 lines, deployed first)
   - Automatically deploys RoseToken and RoseReputation in its constructor
   - Central hub for task management and lifecycle orchestration
   - Handles token minting and distribution (60/20/20 split)
   - Manages task statuses: StakeholderRequired → Open → InProgress → Completed → ApprovedPendingPayment → Closed
   - Includes faucet functionality for testing (claim tokens)
   - Base reward: 100 ROSE tokens per task

2. **RoseToken** (94 lines)
   - ERC20 token with name "Rose Token", symbol "ROSE", 18 decimals
   - Minting restricted to RoseMarketplace contract only
   - Standard transfer, approve, transferFrom functionality

3. **RoseReputation** (132 lines)
   - Tracks reputation and experience for all three roles (Customer, Worker, Stakeholder)
   - Separate reputation tracking per role
   - Called by marketplace when tasks complete successfully

4. **StakeholderRegistry** (213 lines)
   - Requires RoseToken and RoseReputation addresses
   - Manages stakeholder registration with 1000 ROSE minimum token requirement
   - Enforces role separation and 14-day cooling period for role changes
   - Blacklist functionality for bad actors
   - Contract authorization system

5. **RoseGovernance** (352 lines)
   - Requires RoseToken, RoseReputation, and RoseMarketplace addresses
   - Implements STAR voting system (scores 0-5 per proposal)
   - Token locking mechanism with configurable duration
   - Minimum 10 ROSE tokens required to create proposals
   - 66% threshold for final payouts
   - Proposal types: Work or Governance
   - Funding sources: DAO treasury or Customer
   - Stores proposal data hashes on IPFS

6. **TokenStaking** (491 lines)
   - Requires RoseToken, StakeholderRegistry, and DAO treasury addresses
   - Minimum stake: 1000 ROSE tokens
   - Lock period: 14 days
   - Ranked choice voting for stakeholder elections
   - Slashing mechanism for penalizing bad behavior
   - Election tracking with IPFS storage

7. **BidEvaluationManager** (110 lines)
   - Requires TokenStaking and RoseMarketplace addresses
   - Handles bid evaluation logic (simplified in MVP)
   - Currently minimal functionality due to MVP scope

After deployment, contracts are linked via setter methods in scripts/deploy.js:
- `roseMarketplace.setStakeholderRegistry(stakeholderRegistryAddress)`
- `roseMarketplace.setGovernanceContract(governanceAddress)`
- `roseGovernance.setMarketplaceTokenStaking(tokenStakingAddress)`
- `roseGovernance.setMarketplaceBidEvaluationManager(bidEvaluationManagerAddress)`
- `stakeholderRegistry.authorizeContract(marketplaceAddress)`

Deployment creates `deployment-output.json` with all contract addresses and displays:
- Deployer's Sepolia ETH balance (initial and final)
- Total ETH used for deployment (gas costs)
- All deployed contract addresses

## Key Contract Interactions

### Task Lifecycle (Simplified MVP Version)

**Task Status Flow:**
```
StakeholderRequired → Open → InProgress → Completed → ApprovedPendingPayment → Closed
```

**Detailed Flow:**

1. **Task Creation** (Status: StakeholderRequired)
   - Customer creates task with ETH deposit via `createTask()`
   - Task includes: title, description, reward (100 ROSE), IPFS data hash
   - Initial status: StakeholderRequired
   - Customer funds held in escrow in marketplace contract

2. **Stakeholder Stakes** (Status: Open)
   - Stakeholder calls `stakeOnTask()` with 10% of task reward
   - Task status changes to Open
   - Task becomes available for workers

3. **Worker Claims Task** (Status: InProgress)
   - Worker calls `claimTask()` to be assigned
   - First-come, first-served (no competitive bidding in MVP)
   - Task status changes to InProgress
   - Worker address locked to task

4. **Worker Completes Work** (Status: Completed)
   - Worker calls `completeTask()` after finishing work
   - Task status changes to Completed
   - Awaits approval from customer and stakeholder

5. **Approval Process** (Status: ApprovedPendingPayment)
   - Customer calls `approveTask()` to confirm satisfactory work
   - Stakeholder calls `approveTask()` to validate quality
   - Both approvals required (in MVP, simpler than multi-stakeholder)
   - Task status changes to ApprovedPendingPayment
   - Tokens minted via RoseToken contract

6. **Payment Distribution** (Status: Closed)
   - Worker calls `acceptPayment()` to receive tokens
   - Distribution occurs:
     - 60 ROSE → Worker (60%)
     - 20 ROSE → Stakeholder (20%)
     - 20 ROSE → DAO Treasury (20%)
   - ETH deposit returned to customer
   - Stakeholder gets their 10% stake back
   - Reputation points awarded via RoseReputation
   - Task status changes to Closed

### Governance Flow
1. Users stake tokens → TokenStaking
2. Proposals created → RoseGovernance
3. STAR voting occurs → RoseGovernance
4. Approved proposals can create tasks → RoseMarketplace

## Frontend Architecture

The frontend uses React 18.2.0 with custom webpack configuration (via react-app-rewired) to handle Web3 dependencies.

### Pages (4 main pages in frontend/src/pages/)
- **TasksPage.jsx** - Main marketplace with task list, creation form, filtering, and task cards
- **GovernancePage.jsx** - DAO governance with proposals, STAR voting, and treasury management
- **ProfilePage.jsx** - User profile display and role management (Customer/Worker/Stakeholder)
- **HelpPage.jsx** - Help documentation and bug reporting functionality

### Component Organization (frontend/src/components/)

**Marketplace Components:**
- `CreateTaskForm.jsx` - Task creation with ETH deposit and IPFS description storage
- `TaskList.jsx` - Display tasks with filtering and sorting
- `TaskCard.jsx` - Individual task display with status and actions
- `TaskFilters.jsx` - Filter options (stakeholder needed, worker needed, my tasks, closed)
- `TokenDistributionChart.jsx` - Visual representation of 60/20/20 token split

**Governance Components:**
- `ProgressTracker.jsx` - Voting progress and proposal status display

**Wallet Components:**
- `TokenBalance.jsx` - Display ROSE token balance
- `NetworkSelector.jsx` - Network/chain selection (Sepolia support)
- `ExchangeRate.jsx` - Token exchange rate display
- `WalletNotConnected.jsx` - Prompts for MetaMask wallet connection

**Layout Components:**
- `Layout.jsx` - Main page wrapper with header and sidebar
- `Header.jsx` - Top navigation bar with wallet connection
- `Sidebar.jsx` - Side navigation menu

**UI Components** (Radix UI primitives):
- `button.jsx`, `card.jsx`, `badge.jsx`, `alert.jsx`, `skeleton.jsx`
- `ErrorMessage.jsx` - Error display utility
- `NotificationCenter.jsx` - Toast notification system

### Custom Hooks (frontend/src/hooks/)
- **useEthereum.js** - MetaMask wallet connection, account management, chain ID tracking
- **useContract.js** - Contract instance initialization, address fetching, method validation
- **useNotifications.js** - Toast notification management
- **useProfile.js** - User profile state management
- **useFaucet.js** - Faucet token claiming functionality

### Utilities

**IPFS Integration (frontend/src/utils/ipfs/):**
- `pinataService.js` - Pinata API integration for uploading/fetching task data and proposals
- `profileService.js` - Profile data IPFS storage and retrieval

**Other Utilities:**
- `taskStatus.js` - Task status constants and helper functions
- `constants/networks.js` - Network configuration (Sepolia support)

### Key Dependencies
- **Blockchain**: ethers.js 5.7.2, @metamask/sdk-react 0.32.1
- **Framework**: React 18.2.0, React Router v6
- **Styling**: Tailwind CSS, Radix UI components
- **Data**: @tanstack/react-query 4.36.1, Recharts 2.15.3
- **IPFS**: @pinata/sdk 2.1.0
- **Security**: DOMPurify 3.2.6 (XSS protection)
- **Build**: react-app-rewired (webpack customization for Node.js polyfills)

### Configuration Files
- **config-overrides.js** - Webpack polyfills for Node.js modules (stream, buffer, process) required for Web3
- **tailwind.config.js** - Tailwind CSS customization
- **postcss.config.js** - PostCSS configuration for Tailwind

## Testing Approach

The project has **7 test suites** covering 1,069 lines of test code. Tests use Hardhat and Chai for contract testing.

### Test Files (test/)

| Test File | Lines | Coverage |
|-----------|-------|----------|
| **RoseMarketplace.test.js** | 228 | Task creation, lifecycle management, payment distribution, escrow |
| **RoseGovernance.test.js** | 252 | Token locking/unlocking, STAR voting, proposal creation, threshold checks |
| **TokenStaking.test.js** | 191 | Staking/unstaking, ranked choice voting, election tracking, slashing |
| **RoseToken.test.js** | 130 | Minting, transfers, allowances, approvals, access control |
| **TaskLifecycleEdgeCases.test.js** | 123 | Edge cases in task workflow, error conditions, invalid states |
| **DetailedDescription.test.js** | 74 | Detailed task description handling and IPFS storage |
| **Faucet.test.js** | 71 | Faucet token claiming, rate limiting, error cases |

### Test Coverage Areas

**Core Functionality:**
- Token minting and distribution (60/20/20 split verification)
- Complete task lifecycle from creation to payment
- Governance voting mechanisms (STAR voting with scores 0-5)
- Staking and unstaking with lock periods
- Reputation tracking across all roles
- Stakeholder registration and role management

**MVP Features (Post-Simplification):**
- Simple task creation with ETH deposits
- First-come, first-served worker claiming
- Single-stakeholder approval workflow
- Direct payment distribution
- Faucet functionality for testing

**Edge Cases & Security:**
- Invalid state transitions
- Unauthorized access attempts
- Time-based operations (block time increases)
- Edge case scenarios in task lifecycle
- Token distribution accuracy

**Note**: Tests for removed features (bidding, multi-stakeholder, comments, disputes, refunds) have been removed as part of MVP simplification.

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npx hardhat test test/RoseMarketplace.test.js
npx hardhat test test/RoseGovernance.test.js
npx hardhat test test/TokenStaking.test.js
npx hardhat test test/RoseToken.test.js
npx hardhat test test/TaskLifecycleEdgeCases.test.js
npx hardhat test test/DetailedDescription.test.js
npx hardhat test test/Faucet.test.js

# Run tests with gas reporting
npx hardhat test --network hardhat
```

## Environment Variables

### Root Directory `.env` (for contract deployment)
```bash
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID
PRIVATE_KEY=your_wallet_private_key_without_0x_prefix
DAO_TREASURY_ADDRESS=0x_treasury_address_for_dao_funds
ETHERSCAN_API_KEY=your_etherscan_api_key_for_verification
```

### Frontend `.env` (frontend/.env)
```bash
# Required Contract Addresses (obtained from deployment-output.json)
REACT_APP_MARKETPLACE_ADDRESS=0x_deployed_marketplace_address
REACT_APP_TOKEN_ADDRESS=0x_deployed_token_address

# Optional: RPC URL (defaults to MetaMask provider)
REACT_APP_ETHEREUM_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID

# IPFS Integration via Pinata
REACT_APP_PINATA_API_KEY=your_pinata_api_key
REACT_APP_PINATA_SECRET_API_KEY=your_pinata_secret_key
REACT_APP_PINATA_JWT=your_pinata_jwt_token
```

**Note**: Use `frontend/.env.example` as a template for required variables.

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
The project has **two CI/CD workflows** in `.github/workflows/`:

#### A. PR Build Workflow (`pr-build.yml`) - Runs on Pull Requests
Two **parallel** jobs that MUST both pass:

1. **build-contracts** job:
   - Install dependencies: `npm ci`
   - Run all tests: `npx hardhat test`
   - Compile contracts: `npx hardhat compile`
   - Generate ABIs: `node scripts/update-abi.js`

2. **build-frontend** job:
   - Install root dependencies: `npm ci`
   - Install frontend dependencies: `cd frontend && npm install`
   - Compile contracts and update ABIs: `npm run update-abi`
   - Build frontend: `cd frontend && npm run build`
   - Uses placeholder contract addresses (`0x0000...`) for build validation
   - Requires Pinata secrets for IPFS integration

#### B. Combined Deploy Workflow (`combined-deploy.yml`) - Main Branch + Manual
Two **sequential** jobs for full deployment:

1. **deploy-contracts** job:
   - Run tests and compile contracts
   - Deploy to Sepolia testnet: `npm run deploy:sepolia`
   - Wait 90 seconds for contract propagation
   - Verify contracts on Etherscan using API v2
   - Save deployment addresses as artifact

2. **deploy-frontend** job (depends on deploy-contracts):
   - Download contract addresses artifact
   - Update ABIs with actual deployed addresses
   - Build frontend with real contract addresses
   - Deploy to GitHub Pages

Common failure points to watch for:
- **Contract test failures**: Check test output for specific failing tests
- **Missing environment variables**: Ensure GitHub secrets are configured (SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY, Pinata keys)
- **Frontend build errors**: Check for React/webpack/dependency issues
- **ABI generation failures**: Ensure contracts compile successfully first
- **Etherscan verification failures**: Check API key and network configuration
- **Deployment failures**: Verify sufficient ETH in deployer wallet for Sepolia gas

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

---

## Recent Changes & Architecture Notes

### October 2024: MVP Simplification (Commit f81f4e3)

The project underwent **major simplification** to focus on core MVP functionality. The following features were **REMOVED**:

#### Removed Contract Features:
- **Bidding System**: `placeBid()`, `selectShortlist()`, `finalizeWorkerSelection()`, `startBiddingPhase()`
- **Multi-Stakeholder Approval**: Simplified to single stakeholder per task
- **Comments System**: `addComment()`, `getTaskComments()`, comment storage
- **Dispute Resolution**: `disputeTask()`, `resolveDispute()`, arbitration logic
- **Complex Refunds**: Simplified refund mechanisms
- **PGP Encryption**: PGP key storage and encrypted messaging removed

#### Removed Frontend Components:
- `CommentSection.jsx` component
- `KeyManagement.jsx` component (PGP key management)
- `pgpService.js` utility (encryption/decryption)
- `uploadEncryptedCommentToIPFS()` from pinataService
- Multi-stakeholder approval UI workflows
- Bidding interface and shortlist displays

#### What Remains (MVP Core):
✅ Task creation with ETH deposits
✅ First-come, first-served worker claiming
✅ Single-stakeholder validation model (10% stake required)
✅ Simple approval workflow (customer + stakeholder)
✅ Token minting and distribution (60/20/20 split)
✅ STAR voting governance system
✅ Token staking for stakeholder elections
✅ Reputation tracking across roles
✅ Faucet for testing
✅ IPFS integration for proposals and task data

### Other Notable Changes

**October 24, 2024** (Commit e685e09):
- Fixed Etherscan verification to use API v2
- Improved error handling in verification process

**October 23, 2024** (Commit 4dba93b):
- Simplified marketplace contracts for MVP
- Removed stakeholder sections from governance page
- Reordered navigation items in sidebar
- Migrated bug reports to Help page
- Fixed proposal status reading in TasksPage

### Current Architecture Philosophy

The codebase follows a **"Progressive Enhancement"** approach:
1. **MVP Phase** (Current): Core functionality with simplified workflows
2. **Future Enhancements**: Complex features can be added back incrementally
   - Competitive bidding and worker selection
   - Multi-stakeholder validation
   - On-chain commenting and messaging
   - Dispute resolution and arbitration
   - Advanced refund mechanisms

### Development Best Practices

When working with this codebase:

1. **Understand MVP Scope**: Don't reference removed features (bidding, comments, disputes, PGP)
2. **Test Coverage**: All 7 test suites must pass before merging
3. **Gas Optimization**: Contracts use aggressive optimization (`runs: 1`, `viaIR: true`)
4. **ABI Synchronization**: Always run `npm run update-abi` after contract changes
5. **Deployment Order**: Follow the specific sequence in scripts/deploy.js
6. **Etherscan Verification**: Uses API v2 with proper error handling
7. **Frontend Environment**: Requires Pinata credentials for IPFS integration
8. **Network Support**: Primarily targets Sepolia testnet (chainId: 11155111)

### Repository Structure Summary

```
rose-token/
├── contracts/           # 7 Solidity contracts (1,851 lines)
├── test/                # 7 test suites (1,069 lines)
├── scripts/             # Deployment and utility scripts
├── frontend/            # React application
│   ├── src/
│   │   ├── pages/       # 4 main pages
│   │   ├── components/  # Feature-organized components
│   │   ├── hooks/       # 5 custom React hooks
│   │   ├── utils/       # IPFS, task status utilities
│   │   ├── contracts/   # 7 generated ABI files
│   │   └── constants/   # Network and configuration constants
├── .github/workflows/   # 2 CI/CD workflows
└── CLAUDE.md            # This file - project guidance for Claude Code
```

### Key Metrics
- **Smart Contracts**: 7 contracts, 1,851 total lines
- **Test Coverage**: 7 test suites, 1,069 total lines
- **Frontend Pages**: 4 main pages (Tasks, Governance, Profile, Help)
- **Custom Hooks**: 5 React hooks for Web3 integration
- **ABI Files**: 7 auto-generated from compiled contracts
- **CI/CD Jobs**: 2 workflows (PR validation + deployment)
- **Token Economics**: 60% worker, 20% stakeholder, 20% DAO
- **Base Task Reward**: 100 ROSE tokens
- **Minimum Stake**: 1000 ROSE (for stakeholders)
- **Minimum Proposal**: 10 ROSE (for governance)

---

## Additional Resources

- **Hardhat Documentation**: https://hardhat.org/docs
- **Ethers.js v5 Docs**: https://docs.ethers.org/v5/
- **React Router v6**: https://reactrouter.com/
- **Tailwind CSS**: https://tailwindcss.com/docs
- **Radix UI**: https://www.radix-ui.com/
- **Pinata IPFS**: https://docs.pinata.cloud/
- **MetaMask SDK**: https://docs.metamask.io/wallet/how-to/use-sdk/

---

**Last Updated**: October 2024 (Post-MVP Simplification)
**Solidity Version**: 0.8.17
**Node Version**: 18.x
**Network**: Sepolia (chainId: 11155111)