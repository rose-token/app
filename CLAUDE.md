# CLAUDE.md

Project guidance for Claude Code. Ask clarifying questions when requirements are unclear.

## WHAT: Project Overview

Rose Token is a Web3 task marketplace on Arbitrum with:
- **5 Solidity contracts**: RoseToken, RoseMarketplace, RoseTreasury, RoseGovernance, vROSE
- **React frontend**: Vite + Wagmi + RainbowKit + TailwindCSS
- **Express backend**: TypeScript + PostgreSQL + ethers.js (Gitcoin Passport signer)

**Tokenomics**: Customer deposits ROSE → Worker gets 95% → Stakeholder gets 5% → DAO mints 2%

## WHY: Key Architecture Decisions

- RoseToken uses authorization mapping (multiple contracts can mint/burn)
- Treasury is RWA-backed (BTC/Gold/USDC via Chainlink + Uniswap V3)
- Governance uses quadratic voting: `√(staked_ROSE) × (reputation/100)`
- Passport signatures prevent Sybil attacks on marketplace actions

## HOW: Development Commands

```bash
# Contracts (root)
npm test                              # Run all Hardhat tests
npm run compile                       # Compile contracts
npm run deploy:arbitrumSepolia        # Deploy to testnet
npm run update-abi                    # Sync ABIs to frontend

# Frontend (frontend/)
npm run dev                           # Vite dev server
npm run build                         # Production build
npm test                              # Vitest tests

# Backend (backend/signer/)
npm run dev                           # Express dev server
docker-compose up --build             # Run with PostgreSQL
```

## Tech Stack

| Layer | Stack |
|-------|-------|
| Contracts | Solidity 0.8.20, OpenZeppelin v5, Hardhat |
| Frontend | React 18, Vite 7, wagmi/viem, TailwindCSS |
| Backend | Express, TypeScript, PostgreSQL, ethers.js |
| Networks | Arbitrum Sepolia (421614), Arbitrum One (42161) |

## Code Conventions

- **Styling**: Use CSS variables via semantic Tailwind classes (`bg-primary`, `text-accent`). Never hardcode colors.
- **Token decimals**: ROSE/vROSE=18, USDC=6, WBTC=8, Chainlink=8. Treasury normalizes to 6.
- **Web3**: Frontend uses wagmi/viem (not ethers.js). Backend uses ethers.js.
- **Imports**: Chainlink v1.5.0 path: `@chainlink/contracts/src/v0.8/shared/interfaces/`

## Git Workflow

Feature branches → PRs → CI passes → Merge. Never push directly to main.

## Detailed Documentation

For task-specific details, see `agent_docs/`:

| File | Contents |
|------|----------|
| `agent_docs/contracts.md` | Contract architecture, deployment order, constants, custom errors, security patterns |
| `agent_docs/frontend.md` | Routes, context providers, hooks (useVaultData, usePassport, useGovernance, etc.) |
| `agent_docs/backend.md` | API endpoints, services, signature formats, deployment |
| `agent_docs/governance.md` | Voting power, proposals, delegation, rewards, vROSE mechanics |
| `agent_docs/testing.md` | Test suites, CI/CD workflows, environment variables |

## Quick Reference

**Task flow**: `StakeholderRequired → Open → InProgress → Completed → ApprovedPendingPayment → Closed`

**Key thresholds**: Passport 20+ to create/stake/claim tasks, 25+ to propose governance

**Contract addresses**: See `frontend/.env` (VITE_*_ADDRESS vars)

## Known Issues & Fixes

Track bugs and their fixes here:
- `RoseTreasury.circulatingSupply()`: Fixed initial state returning 1 instead of 0 when supply=0
