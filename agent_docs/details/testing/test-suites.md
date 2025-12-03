# Test Suites - Detailed Documentation

**Parent**: [testing.md](../../testing.md) | **Location**: `test/`

---

## Overview

4 test suites covering contract functionality:

| File | Lines | Focus |
|------|-------|-------|
| `RoseMarketplace.test.js` | 557 | Task lifecycle, payments, escrow |
| `RoseToken.test.js` | 130 | Minting, transfers, authorization |
| `TaskLifecycleEdgeCases.test.js` | 167 | Edge cases, error conditions |
| `DetailedDescription.test.js` | 100 | IPFS integration |

---

## Test Commands

```bash
# Run all tests
npm test

# Run specific test file
npx hardhat test test/RoseMarketplace.test.js

# Run with gas reporting
REPORT_GAS=true npm test

# Run with coverage
npx hardhat coverage
```

---

## Mock Contracts

Located in `contracts/mocks/`:

### MockV3Aggregator

Simulates Chainlink price feeds.

```solidity
contract MockV3Aggregator {
    int256 public answer;
    uint8 public decimals;
    uint256 public updatedAt;

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals = _decimals;
        answer = _initialAnswer;
        updatedAt = block.timestamp;
    }

    function updateAnswer(int256 _answer) external {
        answer = _answer;
        updatedAt = block.timestamp;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (1, answer, block.timestamp, updatedAt, 1);
    }
}
```

**Usage in tests**:
```javascript
const btcPriceFeed = await MockV3Aggregator.deploy(8, 50000_00000000n); // $50,000
const goldPriceFeed = await MockV3Aggregator.deploy(8, 2000_00000000n);  // $2,000
```

### MockUniswapV3Router

Simulates Uniswap V3 swaps with configurable exchange rates.

```solidity
contract MockUniswapV3Router {
    mapping(address => mapping(address => uint256)) public exchangeRates;

    function setExchangeRate(address tokenIn, address tokenOut, uint256 rate) external {
        exchangeRates[tokenIn][tokenOut] = rate;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external returns (uint256 amountOut)
    {
        uint256 rate = exchangeRates[params.tokenIn][params.tokenOut];
        amountOut = (params.amountIn * rate) / 1e18;
        // Transfer tokens...
    }
}
```

### MockERC20

Standard ERC20 with public mint for testing.

```solidity
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function faucet(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}
```

---

## Token Acquisition Pattern

Tests obtain ROSE tokens via Treasury deposit flow (not direct minting):

```javascript
async function getRoseTokens(user, usdcAmount) {
  // 1. Mint USDC to user
  await usdc.mint(user.address, usdcAmount);

  // 2. Approve Treasury
  await usdc.connect(user).approve(treasury.address, usdcAmount);

  // 3. Deposit USDC, receive ROSE
  await treasury.connect(user).deposit(usdcAmount);

  // Now user has ROSE tokens based on NAV price
}
```

**Why**: Tests the real deposit flow rather than synthetic minting.

---

## RoseMarketplace.test.js

### Test Categories

1. **Deployment**
   - Contract initialization
   - Token references set correctly
   - Owner set correctly

2. **Task Creation**
   - Create task with valid passport signature
   - Reject invalid signatures
   - Reject expired signatures
   - Reject reused signatures
   - Emit TaskCreated event

3. **Stakeholder Staking**
   - Stake 10% of task value
   - vROSE transferred to marketplace
   - Reject insufficient vROSE balance
   - Reject double staking

4. **Task Claiming**
   - Worker claims open task
   - Task status changes to InProgress
   - Reject claiming by customer/stakeholder
   - Reject claiming closed tasks

5. **Task Completion**
   - Worker submits work
   - Stakeholder approves
   - Payment distribution (95/5 split)
   - DAO mint (2%)
   - vROSE returned to stakeholder

6. **Task Cancellation**
   - Customer can cancel before claim
   - Stakeholder can cancel before claim
   - Refund logic
   - Reject cancellation after claim

### Example Test

```javascript
describe("Task Completion", function() {
  it("should distribute payments correctly on approval", async function() {
    // Setup
    const taskValue = parseUnits("1000", 18);
    await createTaskWithStakeholder(taskValue);
    await claimTask(worker);
    await completeWork(worker);

    // Get balances before
    const workerBalanceBefore = await roseToken.balanceOf(worker.address);
    const stakeholderBalanceBefore = await roseToken.balanceOf(stakeholder.address);
    const treasuryBalanceBefore = await roseToken.balanceOf(daoTreasury);

    // Approve
    await marketplace.connect(stakeholder).approveWork(taskId);

    // Verify 95% to worker
    const workerShare = (taskValue * 95n) / 100n;
    expect(await roseToken.balanceOf(worker.address))
      .to.equal(workerBalanceBefore + workerShare);

    // Verify 5% to stakeholder (plus stake return)
    const stakeholderShare = (taskValue * 5n) / 100n;
    const stakeAmount = (taskValue * 10n) / 100n;
    // Note: stakeholder gets fee + stake back, but stake was in vROSE

    // Verify 2% minted to DAO
    const daoMint = (taskValue * 2n) / 100n;
    expect(await roseToken.balanceOf(daoTreasury))
      .to.equal(treasuryBalanceBefore + daoMint);
  });
});
```

---

## RoseToken.test.js

### Test Categories

1. **Basic ERC20**
   - Transfer
   - TransferFrom with approval
   - Allowance tracking

2. **Authorization**
   - setAuthorized by owner
   - Reject setAuthorized by non-owner
   - Authorized can mint
   - Non-authorized cannot mint

3. **Minting/Burning**
   - Mint increases balance and supply
   - Burn decreases balance and supply
   - Burn rejects insufficient balance

### Example Test

```javascript
describe("Authorization", function() {
  it("should allow owner to authorize addresses", async function() {
    expect(await roseToken.authorized(treasury.address)).to.be.false;

    await roseToken.setAuthorized(treasury.address, true);

    expect(await roseToken.authorized(treasury.address)).to.be.true;
  });

  it("should reject setAuthorized from non-owner", async function() {
    await expect(
      roseToken.connect(user1).setAuthorized(user2.address, true)
    ).to.be.revertedWithCustomError(roseToken, "NotOwner");
  });
});
```

---

## TaskLifecycleEdgeCases.test.js

### Test Categories

1. **Role Separation**
   - Customer cannot be stakeholder
   - Customer cannot be worker
   - Stakeholder cannot be worker

2. **State Transitions**
   - Cannot claim non-open task
   - Cannot approve non-completed task
   - Cannot cancel after claim

3. **Signature Replay**
   - Same signature rejected twice
   - Different action with same nonce

4. **Balance Edge Cases**
   - Zero task value rejected
   - Insufficient ROSE for deposit
   - Insufficient vROSE for stake

---

## DetailedDescription.test.js

### Test Categories

1. **IPFS Hash Storage**
   - Store and retrieve IPFS hash
   - Hash included in events

2. **Description Updates**
   - Update description hash
   - Only customer can update

---

## Test Fixtures

Common setup pattern using Hardhat fixtures:

```javascript
async function deployFixture() {
  const [owner, customer, stakeholder, worker, daoTreasury] = await ethers.getSigners();

  // Deploy mocks
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USDC", "USDC");
  const wbtc = await MockERC20.deploy("WBTC", "WBTC");
  const paxg = await MockERC20.deploy("PAXG", "PAXG");

  const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
  const btcFeed = await MockV3Aggregator.deploy(8, 50000_00000000n);
  const goldFeed = await MockV3Aggregator.deploy(8, 2000_00000000n);

  // Deploy core contracts
  const RoseToken = await ethers.getContractFactory("RoseToken");
  const roseToken = await RoseToken.deploy("Rose Token", "ROSE", owner.address);

  // ... deploy other contracts

  // Setup authorizations
  await roseToken.setAuthorized(treasury.address, true);
  await roseToken.setAuthorized(marketplace.address, true);

  return { roseToken, marketplace, treasury, /* ... */ };
}

describe("RoseMarketplace", function() {
  beforeEach(async function() {
    const fixture = await loadFixture(deployFixture);
    Object.assign(this, fixture);
  });
});
```

---

## Signature Generation for Tests

```javascript
async function generatePassportSignature(signer, address, action, expiry) {
  const messageHash = ethers.solidityPackedKeccak256(
    ["address", "string", "uint256"],
    [address, action, expiry]
  );

  return await signer.signMessage(ethers.getBytes(messageHash));
}

// Usage
const expiry = Math.floor(Date.now() / 1000) + 3600;
const signature = await generatePassportSignature(passportSigner, customer.address, "createTask", expiry);

await marketplace.connect(customer).createTask(
  "Task Title",
  descriptionHash,
  parseUnits("100", 18),
  deadline,
  expiry,
  signature
);
```

---

## Gas Reporting

Enable gas reporting:

```bash
REPORT_GAS=true npm test
```

Output example:
```
·--------------------------------------|----------------------------|-------------|-----------------------------·
|         Contract                     ·  Method                    ·  Gas        ·  % of limit                 │
·--------------------------------------|----------------------------|-------------|-----------------------------·
|  RoseMarketplace                     ·  createTask                ·     185234  ·        0.6 %                │
|  RoseMarketplace                     ·  stakeholderStake          ·     142567  ·        0.5 %                │
|  RoseMarketplace                     ·  claimTask                 ·      98234  ·        0.3 %                │
·--------------------------------------|----------------------------|-------------|-----------------------------·
```

---

## CI Integration

Tests run in CI via `.github/workflows/pr-build.yml`:

```yaml
build-contracts:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: npm ci
    - run: npm test
    - run: npx hardhat compile
```
