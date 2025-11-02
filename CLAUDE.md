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

Rose Token is a decentralized Web3 marketplace with a task-value-based token distribution model. The project consists of:
- Solidity smart contracts for the Ethereum blockchain (2 contracts)
- React frontend for user interaction
- Three core roles: Customers (create tasks), Workers (complete tasks), Stakeholders (validate work)
- **New Tokenomics (as of October 2024)**: 93% worker, 5% stakeholder, 2% DAO
  - Customer pays task value in ROSE tokens (escrowed)
  - Stakeholder stakes 10% of task value (returned on completion)
  - Platform mints 2% of task value → DAO treasury (creates ~2% annual inflation)
  - Total distribution pot = customer payment + minted tokens (1.02x task value)
  - Worker receives 93% of pot, Stakeholder receives 5% fee + stake back (50% ROI on stake)

### MVP Status (October 2024)
The project is currently in **MVP (Minimum Viable Product)** mode. Complex features have been removed to focus on core functionality:

**REMOVED FEATURES** (as of commit f81f4e3):
- Competitive bidding system (placeBid, selectShortlist, finalizeWorkerSelection)
- Multi-stakeholder approval workflow
- Comments system (addComment, getTaskComments)
- Dispute resolution mechanisms
- Complex refund logic
- PGP key storage and encryption
- Reputation tracking and experience points (RoseReputation contract)

**CURRENT MVP FEATURES**:
- Simple task creation with ROSE token deposits (escrowed in marketplace contract)
- Single-stakeholder validation model (10% stake required in ROSE tokens)
- Direct worker claiming (first-come, first-served)
- Straightforward approval and payment flow
- Token minting and distribution (93/5/2 split)
- Token staking for stakeholder elections (future use)
- Initial DAO treasury funded with 10,000 ROSE on deployment

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

The smart contracts have a simple deployment structure:

1. **RoseMarketplace** (331 lines, deployed first)
   - Automatically deploys RoseToken in its constructor
   - Mints initial 10,000 ROSE to DAO treasury on deployment
   - Central hub for task management and lifecycle orchestration
   - Handles token minting and distribution (93/5/2 split)
   - Manages task statuses: StakeholderRequired → Open → InProgress → Completed → ApprovedPendingPayment → Closed
   - Escrows customer's ROSE token payment until task completion
   - Mints 2% of task value to DAO treasury on completion (creates ~2% annual inflation)

2. **RoseToken** (94 lines)
   - ERC20 token with name "Rose Token", symbol "ROSE", 18 decimals
   - Minting restricted to RoseMarketplace contract only
   - Standard transfer, approve, transferFrom functionality

Deployment creates `deployment-output.json` with contract addresses and displays:
- Deployer's Sepolia ETH balance (initial and final)
- Total ETH used for deployment (gas costs)
- All deployed contract addresses

## Key Contract Interactions

### Task Lifecycle (Simplified MVP Version)

**Task Status Flow:**
```
StakeholderRequired → Open → InProgress → Completed → ApprovedPendingPayment → Closed
     ↓               ↓
     └───────────────┴──→ (cancelTask) → Closed (with refunds)
```

**Detailed Flow:**

1. **Task Creation** (Status: StakeholderRequired)
   - Customer creates task via `createTask()` with:
     - **Title**: Short public description (max 100 chars, on-chain)
     - **IPFS Hash**: Hash of detailed description (mandatory, stored on IPFS)
     - **Token Amount**: Payment in ROSE tokens
   - Customer must approve marketplace contract to transfer tokens
   - Detailed description uploaded to IPFS before contract call
   - Initial status: StakeholderRequired
   - Customer's ROSE tokens held in escrow in marketplace contract

2. **Stakeholder Stakes** (Status: Open)
   - Stakeholder calls `stakeholderStake()` with exactly 10% of task value in ROSE tokens
   - Stakeholder must approve marketplace contract to transfer tokens
   - Task status changes to Open
   - Task becomes available for workers
   - Stakeholder's 10% stake held in escrow

3. **Worker Claims Task** (Status: InProgress)
   - Worker calls `claimTask()` to claim the task
   - First-come, first-served (no competitive bidding in MVP)
   - Task status changes to InProgress
   - Worker address locked to task

3.5. **Worker Unclaims Task** (Optional, Status: Open)
   - Worker calls `unclaimTask()` to release the task
   - Available only while task is in `InProgress` status
   - Cannot unclaim after marking task as `Completed`
   - Task status reverts to `Open`
   - Worker address is cleared from task
   - Another worker can now claim the task
   - Emits `TaskUnclaimed` event

4. **Worker Completes Work** (Status: Completed)
   - Worker calls `markTaskCompleted()` after finishing work
   - Task status changes to Completed
   - Awaits approval from customer and stakeholder

5. **Approval Process** (Status: ApprovedPendingPayment)
   - Customer calls `approveCompletionByCustomer()` to confirm satisfactory work
   - Stakeholder calls `approveCompletionByStakeholder()` to validate quality
   - Both approvals required (can be done in any order)
   - Task status changes to ApprovedPendingPayment when both approvals received
   - Task ready for worker to accept payment

6. **Payment Distribution** (Status: Closed)
   - Worker calls `acceptPayment()` to trigger distribution
   - Platform mints 2% of task value to DAO treasury
   - Total distribution pot = customer deposit + minted tokens (1.02x task value)
   - Distribution occurs from the pot:
     - **Worker**: 93% of pot (e.g., 9.486 ROSE for 10 ROSE task)
     - **Stakeholder**: 5% of pot as fee + 10% stake returned (e.g., 1.51 ROSE total for 10 ROSE task)
     - **DAO Treasury**: 2% minted (e.g., 0.2 ROSE for 10 ROSE task)
   - Task status changes to Closed

**Task Cancellation (Alternative Flow):**

Tasks can be cancelled before a worker claims them. Cancellation is available from two states:

- **From StakeholderRequired Status**:
  - Customer can call `cancelTask()` to cancel before stakeholder stakes
  - Customer deposit is fully refunded
  - Task status set to Closed

- **From Open Status**:
  - Either customer OR stakeholder can call `cancelTask()` to cancel
  - Customer deposit is fully refunded
  - Stakeholder deposit (10% stake) is fully refunded
  - Task status set to Closed

**Cancellation Restrictions:**
- Cannot cancel once a worker has claimed the task (status InProgress or later)
- Only customer or stakeholder can cancel (not random addresses)
- Emits `TaskCancelled` event with refund amounts for tracking

**Tokenomics Example (10 ROSE task):**
- Customer deposits: 10 ROSE (escrowed)
- Stakeholder stakes: 1 ROSE (10%, escrowed)
- Platform mints: 0.2 ROSE → DAO
- Total pot: 10.2 ROSE
- Worker receives: 9.486 ROSE (93% of 10.2)
- Stakeholder receives: 1.51 ROSE (1.0 stake + 0.51 fee = 51% ROI on stake)
- DAO receives: 0.2 ROSE (creates ~2% annual inflation as tasks complete)

**Note**: The task creation is now direct through the marketplace. There is no separate governance proposal workflow in the current MVP.

### Role Separation & Security Requirements

**IMPORTANT**: The RoseMarketplace contract enforces strict role separation to prevent conflicts of interest:

**Role Uniqueness Requirement:**
- All three roles (customer, stakeholder, worker) **MUST** be held by different addresses on the same task
- No address can hold multiple roles on a single task
- This prevents self-dealing and maintains validation integrity

**Enforced Restrictions:**

1. **Customer ≠ Stakeholder** (enforced in `stakeholderStake()`)
   - Customer cannot be stakeholder for their own task
   - Error: "Customer cannot be stakeholder for their own task"

2. **Customer ≠ Worker** (enforced in `claimTask()`)
   - Customer cannot claim their own task
   - Error: "Customer cannot claim their own task"

3. **Stakeholder ≠ Worker** (enforced in `claimTask()`)
   - Stakeholder cannot claim task they are validating
   - Error: "Stakeholder cannot claim task they are validating"
   - **This prevents the critical conflict of interest where a stakeholder validates their own work**

4. **Worker ≠ Stakeholder** (edge case, enforced in `stakeholderStake()`)
   - Worker cannot become stakeholder for their own task
   - Error: "Worker cannot be stakeholder for their own task"

**Frontend Validation:**
- TasksPage.jsx checks for role conflicts before claiming tasks
- TaskCard.jsx disables "Claim Task" button if user is the stakeholder
- User-friendly error messages displayed for all role conflicts

**Security Rationale:**
- **Prevents self-dealing**: No one can pay themselves or approve their own work
- **Maintains validation integrity**: Stakeholders must be independent validators
- **Ensures fairness**: All parties have aligned but separate incentives
- **Protects tokenomics**: Prevents gaming of the 93/5/2 distribution model

### IPFS Integration & Privacy

**Task Description Storage:**
- **Title** (on-chain): Short public title, visible to everyone
- **Detailed Description** (IPFS): Comprehensive details, private to participants

**IPFS Upload Process:**
1. User writes detailed description in CreateTaskForm
2. Frontend uploads to IPFS via Pinata API
3. Returns IPFS hash (e.g., `QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG`)
4. Hash stored in contract `detailedDescriptionHash` field
5. Content never stored on-chain (gas optimization)

**Privacy Enforcement:**
- Frontend checks `isTaskParticipant(taskId)` before fetching IPFS content
- Only customer, stakeholder, and worker can view detailed description
- Non-participants see privacy notice
- IPFS content is public but hash is not discoverable without contract access

**Benefits:**
- Reduces gas costs (no long strings on-chain)
- Protects sensitive task requirements
- Enables rich formatting (markdown, structured data)
- Immutable task specifications

## Frontend Architecture

The frontend uses React 18.2.0 with custom webpack configuration (via react-app-rewired) to handle Web3 dependencies.

### Pages (3 main pages in frontend/src/pages/)
- **TasksPage.jsx** - Main marketplace with task list, filtering, and task cards
- **ProfilePage.jsx** - User profile display and role management (Customer/Worker/Stakeholder)
- **HelpPage.jsx** - Help documentation and bug reporting functionality

### Component Organization (frontend/src/components/)

**Marketplace Components:**
- `TaskList.jsx` - Display tasks with filtering and sorting
- `TaskCard.jsx` - Individual task display with status and actions
- `TaskFilters.jsx` - Filter options (stakeholder needed, worker needed, my tasks, closed)
- `TokenDistributionChart.jsx` - Visual representation of 93/5/2 token split
- `ProgressTracker.jsx` - Task progress tracking for participants

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

### Utilities

**IPFS Integration (frontend/src/utils/ipfs/):**
- `pinataService.js` - Pinata API integration for uploading/fetching task data
  - `uploadTaskDescription()` - Upload detailed descriptions to IPFS
  - `fetchTaskDescription()` - Retrieve task descriptions from IPFS
  - `uploadProposalToIPFS()`, `fetchProposalFromIPFS()` - Proposal management
  - `uploadCommentToIPFS()`, `fetchCommentFromIPFS()` - Comment management
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

The project has **4 test suites** covering ~555 lines of test code. Tests use Hardhat and Chai for contract testing.

### Test Files (test/)

| Test File | Lines | Coverage |
|-----------|-------|----------|
| **RoseMarketplace.test.js** | 228 | Task creation, lifecycle management, payment distribution, escrow |
| **RoseToken.test.js** | 130 | Minting, transfers, allowances, approvals, access control |
| **TaskLifecycleEdgeCases.test.js** | 123 | Edge cases in task workflow, error conditions, invalid states |
| **DetailedDescription.test.js** | 74 | Detailed task description handling and IPFS storage |

### Test Coverage Areas

**Core Functionality:**
- Token minting and distribution (93/5/2 split verification)
- Complete task lifecycle from creation to payment

**MVP Features (Post-Simplification):**
- Simple task creation with ROSE token deposits
- First-come, first-served worker claiming
- Single-stakeholder approval workflow
- Direct payment distribution
- Initial DAO treasury funding (10,000 ROSE on deployment)

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
npx hardhat test test/RoseToken.test.js
npx hardhat test test/TaskLifecycleEdgeCases.test.js
npx hardhat test test/DetailedDescription.test.js

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

### October 2025: Worker Unclaim Feature

Added ability for workers to unclaim tasks they've claimed but cannot complete:

**Contract Changes:**
- New `unclaimTask()` function in RoseMarketplace.sol (line 229)
- New `TaskUnclaimed` event (line 61)
- Only worker can unclaim, only while InProgress
- Task reverts to Open status when unclaimed
- Worker address cleared, allowing another worker to claim

**Test Coverage:**
- Added 4 test cases to RoseMarketplace.test.js
- Added 1 edge case test to TaskLifecycleEdgeCases.test.js
- Tests verify unclaim functionality, event emission, role restrictions, and re-claiming

**Frontend:**
- Added "Unclaim Task" button visible to assigned worker (TaskCard.jsx)
- Shows while task is InProgress
- Yellow color (#F59E0B) to differentiate from other actions
- Handler added to TasksPage.jsx with error handling

**Benefits:**
- Prevents tasks from being stuck indefinitely
- Improves marketplace liquidity
- Better UX for both workers and customers
- No financial penalty for honest workers who realize they can't complete
- Enables task reassignment without requiring cancellation

### October 2024: New Tokenomics Model (Commit 445df00)

The project implemented a **new task-value-based tokenomics model** replacing the old fixed-reward system:

#### Changes to Token Distribution:
**Old Model (removed):**
- Fixed 100 ROSE base reward minted per task
- Split: 60% worker, 20% stakeholder, 20% DAO
- All payments came from minted tokens

**New Model (current):**
- Task-value-based distribution (no fixed base reward)
- Mint only 2% of task value → DAO treasury (creates ~2% annual inflation)
- Total distribution pot = customer payment + minted tokens (1.02x task value)
- Split from pot: **93% worker, 5% stakeholder fee, 2% DAO**
- Stakeholder gets 10% stake returned + 5% fee (50% ROI on stake)

#### Implementation Changes:
**Contract Changes (RoseMarketplace.sol):**
- Removed `BASE_REWARD` constant
- Added `MINT_PERCENTAGE = 2` constant
- Updated distribution percentages: `WORKER_SHARE = 93`, `STAKEHOLDER_SHARE = 5`, `TREASURY_SHARE = 2`
- Rewrote `_finalizeTask()` to implement new distribution logic
- Removed old `_mintReward()` function

**Test Updates (RoseMarketplace.test.js):**
- Updated test constants to match new tokenomics
- Fixed calculation expectations for worker payments
- Updated token distribution verification tests

#### Example Transaction Flow (10 ROSE task):
**Inputs:**
- Customer deposits: 10 ROSE (escrowed in marketplace)
- Stakeholder stakes: 1 ROSE (10% of task value, escrowed)

**On Task Completion:**
- Platform mints: 0.2 ROSE → DAO treasury
- Total pot: 10.2 ROSE (10 + 0.2)
- Worker receives: 9.486 ROSE (93% of 10.2)
- Stakeholder receives: 1.51 ROSE total
  - 1.0 ROSE (stake returned)
  - 0.51 ROSE (5% of 10.2 as fee)
  - 51% ROI on 1 ROSE stake
- DAO receives: 0.2 ROSE (2% of task value, already minted)

#### Why This Change:
- **Worker-Focused Economics**: Workers receive 93% of value, up from 60%
- **Sustainable Inflation**: Only 2% minted per task (vs 100% in old model)
- **Stakeholder Incentive**: 50% ROI on stake encourages quality validation
- **Task-Value Scaling**: Distribution scales with actual task value, not fixed amount
- **Clearer Value Proposition**: $1000 task pays ~$950 to worker (93% of $1020)

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
✅ Task creation with ROSE token deposits (direct, no governance)
✅ First-come, first-served worker claiming
✅ Single-stakeholder validation model (10% stake required in ROSE tokens)
✅ Simple approval workflow (customer + stakeholder)
✅ Token minting and distribution (93/5/2 split, task-value-based)
✅ Token staking for stakeholder elections (deployed but not integrated)
✅ Initial DAO treasury funded with 10,000 ROSE on deployment
✅ IPFS integration for task data

### October 2024: Governance Layer Removal (Commit 722b17f)

The project underwent **additional simplification** by removing the entire governance layer:

#### Removed Contracts:
- **RoseGovernance.sol** (285 lines) - Entire governance contract removed
- Removed `governanceContract` references from RoseMarketplace
- Removed `createTaskFromGovernance()` function
- Removed `onlyGovernance` modifier

#### Removed Frontend Code:
- **GovernancePage.jsx** - Entire governance page (~300 lines)
- Proposal creation UI from TasksPage (~450 lines)
- Governance route from App.js routing
- Governance navigation link from Sidebar
- `roseGovernance` contract initialization from useContract hook
- `RoseGovernanceABI.json` file

#### Why This Change:
- **Eliminated Duplicate Workflows**: Governance proposals and direct task creation were redundant
- **Removed Mandatory Delays**: No more 2-day execution delay for tasks
- **Simplified User Experience**: One clear path for task creation
- **Fixed Worker Claim Issue**: Tasks now immediately available to workers after stakeholder stakes
- **Reduced Complexity**: Removed 2,517 lines of code total

#### New Simplified Flow:
```
Customer → createTask() → StakeholderRequired
         ↓
Stakeholder → stakeholderStake() → Open (workers can claim!)
         ↓
Worker → claimTask() → InProgress
         ↓
Worker → completeTask() → Completed
         ↓
Customer + Stakeholder approve → ApprovedPendingPayment
         ↓
Worker → acceptPayment() → Closed
```

### October 2024: Reputation System Removal

The project underwent **further simplification** by removing the RoseReputation contract and all reputation tracking:

#### Removed Components:
- **RoseReputation.sol** (132 lines) - Entire reputation contract removed
- Removed reputation tracking for Customer, Worker, and Stakeholder roles
- Removed experience point awards throughout task lifecycle
- Removed reputation level calculations and minting bonuses
- Removed `roseReputation` references from RoseMarketplace
- Removed RoseReputation parameter from StakeholderRegistry constructor
- Removed RoseReputationABI from frontend and useContract hook

#### Why This Change:
- **Simplified MVP**: Reputation system added complexity without immediate value
- **Focus on Core Mechanics**: Task completion and payment flow are the priority
- **Future Enhancement**: Reputation can be added back as a separate module later
- **Reduced Gas Costs**: Fewer contract calls during task lifecycle
- **Cleaner Architecture**: Fewer dependencies between contracts

### October 2024: BidEvaluationManager Contract Removal

The project underwent **additional simplification** by removing the BidEvaluationManager contract:

#### Removed Components:
- **BidEvaluationManager.sol** (110 lines) - Entire contract removed
- Removed `bidEvaluationManager` address variable from RoseMarketplace
- Removed `setBidEvaluationManager()` function from RoseMarketplace
- Removed BidEvaluationManager deployment from scripts/deploy.js
- Removed BidEvaluationManager from scripts/update-abi.js
- Removed BidEvaluationManagerABI.json from frontend
- Removed all BidEvaluationManager references from frontend/src/hooks/useContract.js

#### Why This Change:
- **Unused in MVP**: Competitive bidding was already removed in earlier MVP simplification
- **No Current Purpose**: Contract handled stakeholder voting on worker selection, which doesn't exist in current first-come, first-served model
- **Reduced Contract Count**: From 5 contracts down to 4 core contracts
- **Simplified Deployment**: Fewer contracts to deploy and maintain
- **Cleaner Architecture**: Removed dead code and unused dependencies

### October 2024: TokenStaking and StakeholderRegistry Contract Removal

The project underwent **further simplification** by removing the TokenStaking and StakeholderRegistry contracts:

#### Removed Components:
- **TokenStaking.sol** (491 lines) - Entire contract removed
- **StakeholderRegistry.sol** (213 lines) - Entire contract removed
- Removed `stakeholderRegistry` and `tokenStaking` address variables from RoseMarketplace
- Removed `setStakeholderRegistry()` and `setTokenStaking()` functions from RoseMarketplace
- Removed StakeholderRegistry role eligibility checks in `stakeholderStake()`
- Removed contract deployments from scripts/deploy.js
- Removed contract linking calls (`setStakeholderRegistry`, `authorizeContract`)
- Removed from scripts/update-abi.js
- Removed TokenStakingABI.json and StakeholderRegistryABI.json from frontend
- Removed all references from frontend/src/hooks/useContract.js

#### Why This Change:
- **Unused in MVP**: Stakeholder registration and token staking were not essential for core functionality
- **Simplified Stakeholder Model**: Removed barriers to entry - any address can now be a stakeholder by staking 10% of task value
- **No Role Management Needed**: Customer check (line 154) is sufficient to prevent conflicts
- **Reduced Contract Count**: From 4 contracts down to 2 core contracts
- **Simplified Deployment**: No contract linking or authorization needed
- **Lower Gas Costs**: Fewer contract calls during stakeholderStake operation
- **Cleaner Architecture**: Direct inline checks instead of external contract dependencies
- **Future Enhancement**: Stakeholder reputation and governance can be added later as separate modules

### Other Notable Changes

**October 24, 2024** (Commit e685e09):
- Fixed Etherscan verification to use API v2
- Improved error handling in verification process

**October 23, 2024** (Commit 4dba93b):
- Simplified marketplace contracts for MVP
- Migrated bug reports to Help page

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

1. **Understand MVP Scope**: Don't reference removed features (bidding, comments, disputes, PGP, governance, reputation, BidEvaluationManager, TokenStaking, StakeholderRegistry)
2. **Test Coverage**: All 5 test suites must pass before merging
3. **Gas Optimization**: Contracts use aggressive optimization (`runs: 1`, `viaIR: true`)
4. **ABI Synchronization**: Always run `npm run update-abi` after contract changes
5. **Deployment Order**: Follow the specific sequence in scripts/deploy.js
6. **Etherscan Verification**: Uses API v2 with proper error handling
7. **Frontend Environment**: Requires Pinata credentials for IPFS integration
8. **Network Support**: Primarily targets Sepolia testnet (chainId: 11155111)

### Repository Structure Summary

```
rose-token/
├── contracts/           # 2 Solidity contracts (~425 lines)
├── test/                # 5 test suites (~626 lines)
├── scripts/             # Deployment and utility scripts
├── frontend/            # React application
│   ├── src/
│   │   ├── pages/       # 3 main pages
│   │   ├── components/  # Feature-organized components
│   │   ├── hooks/       # 5 custom React hooks
│   │   ├── utils/       # IPFS, task status utilities
│   │   ├── contracts/   # 2 generated ABI files
│   │   └── constants/   # Network and configuration constants
├── .github/workflows/   # 2 CI/CD workflows
└── CLAUDE.md            # This file - project guidance for Claude Code
```

### Key Metrics
- **Smart Contracts**: 2 contracts (RoseReputation, BidEvaluationManager, TokenStaking, and StakeholderRegistry removed for MVP)
- **Test Coverage**: 5 test suites, ~626 total lines
- **Frontend Pages**: 3 main pages (Tasks, Profile, Help)
- **Custom Hooks**: 5 React hooks for Web3 integration
- **ABI Files**: 2 auto-generated from compiled contracts
- **CI/CD Jobs**: 2 workflows (PR validation + deployment)
- **Token Economics**: 93% worker, 5% stakeholder, 2% DAO (from 1.02x pot)
- **Token Distribution Model**: Task-value-based (no fixed base reward)
- **Platform Minting**: 2% of task value → DAO (creates ~2% annual inflation)
- **Stakeholder Stake Required**: 10% of task value (returned on completion)
- **Stakeholder ROI**: 50% on stake (5% fee on 10% stake)

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

**Last Updated**: October 2024 (New Tokenomics Model - 93/5/2)
**Solidity Version**: 0.8.17
**Node Version**: 18.x
**Network**: Sepolia (chainId: 11155111)