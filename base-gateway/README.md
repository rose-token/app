# Rose Base Gateway

Base-side gateway that lets agents deposit and redeem USDC on **Base** while the Rose Treasury lives on **Arbitrum**. Uses [Circle CCTP](https://developers.circle.com/stablecoins/cctp-getting-started) for native USDC bridging — no slippage, no liquidity pools.

## Architecture

```
                          BASE (Chain 8453)                                          ARBITRUM (Chain 42161)
  ┌─────────────────────────────────────────────────┐          ┌─────────────────────────────────────────────────┐
  │                                                 │          │                                                 │
  │   Agent Wallet                                  │          │   Signer Backend                                │
  │       │                                         │          │       │                                         │
  │       │ 1. approve + deposit(usdcAmount)        │          │       │                                         │
  │       ▼                                         │          │       │                                         │
  │  ┌──────────────────┐                           │          │  ┌──────────────────┐                           │
  │  │ RoseBaseGateway  │                           │          │  │  RoseTreasury    │                           │
  │  │                  │  2. depositForBurn()       │   CCTP   │  │  0xdDdF...76BB   │                           │
  │  │  pendingDeposits ├───────────────────────────┼──────────┤  │                  │                           │
  │  │  balances        │                           │          │  │  deposit()       │                           │
  │  │  pendingRedeems  │  6. completeDeposit()     │          │  │  redeem()        │                           │
  │  │                  │◄──────────────────────────┼──────────┤  │                  │                           │
  │  └──────────────────┘                           │          │  └──────────────────┘                           │
  │                                                 │          │                                                 │
  │  Base USDC: 0x8335...2913                       │          │  Arb USDC:  0xaf88...5831                       │
  │  TokenMessenger: 0x1682...8962                   │          │  ROSE:      0xFD48...c520                       │
  │                                                 │          │  TokenMessenger: 0x1933...E08A                   │
  └─────────────────────────────────────────────────┘          └─────────────────────────────────────────────────┘
```

## Flows

### Deposit Flow (Agent → ROSE balance)

```
  Agent (Base)            Gateway (Base)           CCTP              Signer (Arb)          Treasury (Arb)
       │                       │                    │                     │                      │
       │ 1. approve(gateway)   │                    │                     │                      │
       ├──────────────────────►│                    │                     │                      │
       │ 2. deposit(amount)    │                    │                     │                      │
       ├──────────────────────►│                    │                     │                      │
       │                       │ 3. depositForBurn()│                     │                      │
       │                       ├───────────────────►│                     │                      │
       │                       │    nonce returned  │                     │                      │
       │                       │◄───────────────────┤                     │                      │
       │                       │                    │                     │                      │
       │              emit DepositInitiated         │                     │                      │
       │                       │                    │ 4. attestation      │                      │
       │                       │                    ├────────────────────►│                      │
       │                       │                    │                     │ 5. receiveMessage()   │
       │                       │                    │                     │  + treasury.deposit() │
       │                       │                    │                     ├─────────────────────►│
       │                       │ 6. completeDeposit │                     │                      │
       │                       │◄────────────────────────────────────────┤                      │
       │                       │   (credits ROSE)   │                     │                      │
       │              emit DepositCompleted          │                     │                      │
```

**Steps:**
1. Agent approves the gateway contract to spend their Base USDC.
2. Agent calls `deposit(usdcAmount)` on the gateway.
3. Gateway pulls USDC and calls CCTP `depositForBurn()` targeting Arbitrum.
4. Off-chain signer monitors `DepositInitiated` events, waits for CCTP attestation (~15 min).
5. Signer calls `receiveMessage()` on Arbitrum to mint USDC, then deposits into Rose Treasury.
6. Signer calls `completeDeposit(nonce, roseAmount)` on Base gateway to credit the agent's virtual ROSE balance.

### Redeem Flow (ROSE balance → Agent USDC)

```
  Agent (Base)            Gateway (Base)           CCTP              Signer (Arb)          Treasury (Arb)
       │                       │                    │                     │                      │
       │ 1. requestRedeem()    │                    │                     │                      │
       ├──────────────────────►│                    │                     │                      │
       │     (balance debited) │                    │                     │                      │
       │              emit RedeemRequested          │                     │                      │
       │                       │                    │                     │ 2. treasury.redeem()  │
       │                       │                    │                     ├─────────────────────►│
       │                       │                    │ 3. depositForBurn() │   (gets USDC back)   │
       │                       │                    │◄────────────────────┤                      │
       │                       │                    │                     │                      │
       │                       │                    │ 4. attestation      │                      │
       │                       │                    │   (USDC arrives     │                      │
       │                       │                    │    at gateway)      │                      │
       │                       │ 5. completeRedeem()│                     │                      │
       │                       │◄────────────────────────────────────────┤                      │
       │  ◄── USDC sent ──────┤                    │                     │                      │
       │              emit RedeemCompleted          │                     │                      │
```

**Steps:**
1. Agent calls `requestRedeem(roseAmount)`. Balance is debited immediately.
2. Signer monitors `RedeemRequested`, calls `treasury.redeem()` on Arbitrum.
3. Signer bridges USDC back to Base via CCTP `depositForBurn()` targeting the gateway.
4. After attestation, USDC arrives at the gateway contract on Base.
5. Signer calls `completeRedeem(redeemId, usdcAmount)` — gateway sends USDC to agent.

## Contract Addresses

| Contract | Chain | Address |
|---|---|---|
| **RoseBaseGateway** | Base | *TBD after deployment* |
| RoseTreasury | Arbitrum | `0xdDdF1C8F065038aa9cCd9eDde128BBC2C9ea76BB` |
| Base USDC | Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Arbitrum USDC | Arbitrum | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| ROSE Token | Arbitrum | `0xFD48CD135D4AB679610bf243b2269B4AFc0bc520` |
| Base TokenMessenger (CCTP) | Base | `0x1682Ae6375C4E4A97e4B583BC394c861A46D8962` |
| Arb TokenMessenger (CCTP) | Arbitrum | `0x19330d10D9Cc8751218eaf51E8885D058642E08A` |

**CCTP Domain IDs:** Base = 6, Arbitrum = 3

## Setup

```bash
cd base-gateway
npm install
cp .env.example .env
# Fill in DEPLOYER_PRIVATE_KEY
```

## Compile

```bash
npx hardhat compile
```

## Deploy

```bash
# Mainnet Base
npx hardhat run scripts/deploy-base-gateway.js --network base

# Local (hardhat)
npx hardhat run scripts/deploy-base-gateway.js --network hardhat
```

## Contract API

### Agent Functions

| Function | Description |
|---|---|
| `deposit(uint256 usdcAmount)` | Deposit USDC → bridge to Arb → earn ROSE |
| `requestRedeem(uint256 roseAmount)` | Request ROSE → USDC redemption |
| `balances(address)` | View virtual ROSE balance |

### Admin / Signer Functions

| Function | Description |
|---|---|
| `completeDeposit(uint64 nonce, uint256 roseAmount)` | Credit ROSE after Arb-side deposit |
| `completeRedeem(uint256 redeemId, uint256 usdcAmount)` | Send USDC after Arb-side redemption |
| `cancelRedeem(uint256 redeemId)` | Cancel failed redeem, refund ROSE balance |
| `setArbitrumRecipient(bytes32)` | Update CCTP destination recipient |
| `pause()` / `unpause()` | Emergency pause |
| `emergencyWithdraw(token, amount, to)` | Rescue stuck tokens |

### Events (for signer to watch)

```solidity
event DepositInitiated(address indexed agent, uint256 usdcAmount, uint64 indexed cctpNonce);
event RedeemRequested(address indexed agent, uint256 roseAmount, uint256 indexed redeemId);
```

## Signer Backend Integration

The signer backend is the off-chain service that completes cross-chain operations. It needs to:

### Watch Base Events
```javascript
// Listen for deposits
gateway.on("DepositInitiated", async (agent, usdcAmount, nonce) => {
  // 1. Wait for CCTP attestation (~15 min)
  //    Poll https://iris-api.circle.com/attestations/{messageHash}
  // 2. Call MessageTransmitter.receiveMessage() on Arbitrum
  // 3. Call RoseTreasury.deposit() on Arbitrum
  // 4. Call gateway.completeDeposit(nonce, roseAmount) on Base
});

// Listen for redemptions
gateway.on("RedeemRequested", async (agent, roseAmount, redeemId) => {
  // 1. Call RoseTreasury.redeem() on Arbitrum
  // 2. Call CCTP depositForBurn() on Arbitrum → Base (target: gateway address)
  // 3. Wait for CCTP attestation
  // 4. Call MessageTransmitter.receiveMessage() on Base
  // 5. Call gateway.completeRedeem(redeemId, usdcAmount) on Base
});
```

### CCTP Attestation Flow
```
1. depositForBurn() emits MessageSent event with `message` bytes
2. Compute keccak256(message) → messageHash
3. Poll Circle attestation API:
   GET https://iris-api.circle.com/attestations/{messageHash}
4. When status="complete", extract `attestation` field
5. Call MessageTransmitter.receiveMessage(message, attestation) on dest chain
```

## Security Considerations

- **Owner = Signer**: The contract owner is the only address that can complete deposits/redeems and manage funds. Use a secure key or multisig.
- **Virtual balances**: ROSE balances are tracked in a mapping on Base but the actual tokens live on Arbitrum. The signer is trusted to keep these in sync.
- **Pausable**: Owner can pause all deposits/redemptions in an emergency.
- **No reentrancy**: All state-changing functions use ReentrancyGuard.
- **Immediate debit on redeem**: When an agent requests a redeem, their balance is debited immediately to prevent double-spend. If the Arb-side operation fails, the signer calls `cancelRedeem()` to refund.
- **Emergency withdraw**: Owner can rescue any stuck ERC-20 tokens.

## Gas Estimates

| Operation | Estimated Gas |
|---|---|
| `deposit()` | ~150k (includes CCTP call) |
| `requestRedeem()` | ~60k |
| `completeDeposit()` | ~50k |
| `completeRedeem()` | ~60k |

*Actual gas depends on Base network conditions.*

## License

MIT
