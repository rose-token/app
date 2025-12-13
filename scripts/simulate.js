const hre = require("hardhat");
const fs = require("fs");
const readline = require("readline");

// ============ ANSI Color Codes ============
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

const log = {
  success: (msg) => console.log(`${colors.green}${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.cyan}${msg}${colors.reset}`),
  dim: (msg) => console.log(`${colors.dim}${msg}${colors.reset}`),
  header: (msg) => console.log(`\n${colors.bright}${colors.magenta}${msg}${colors.reset}`),
};

// ============ Config ============
const SIGNER_API_URL = process.env.PASSPORT_SIGNER_URL || 'https://signer.rose-token.com';

// ============ Global State ============
let deployment = null;
let contracts = {};
let deployer = null;

// ============ Setup Functions ============

async function loadDeployment() {
  if (!fs.existsSync("deployment-output.json")) {
    log.error("deployment-output.json not found. Run deploy.js first.");
    process.exit(1);
  }
  deployment = JSON.parse(fs.readFileSync("deployment-output.json"));
  log.success("Loaded deployment addresses from deployment-output.json");
  return deployment;
}

async function loadContracts() {
  // Core contracts - connect to deployer for write operations
  contracts.roseToken = (await hre.ethers.getContractAt("RoseToken", deployment.tokenAddress)).connect(deployer);
  contracts.treasury = (await hre.ethers.getContractAt("RoseTreasury", deployment.treasuryAddress)).connect(deployer);
  contracts.marketplace = (await hre.ethers.getContractAt("RoseMarketplace", deployment.marketplaceAddress)).connect(deployer);
  contracts.governance = (await hre.ethers.getContractAt("RoseGovernance", deployment.governanceAddress)).connect(deployer);
  contracts.vRose = (await hre.ethers.getContractAt("vROSE", deployment.vRoseAddress)).connect(deployer);

  // Mock contracts - MUST connect to deployer for write operations (ethers v6 requirement)
  const ext = deployment.externalAddresses;
  contracts.usdc = (await hre.ethers.getContractAt("MockERC20", ext.usdc)).connect(deployer);
  contracts.tbtc = (await hre.ethers.getContractAt("MockERC20", ext.tbtc)).connect(deployer);
  contracts.xaut = (await hre.ethers.getContractAt("MockERC20", ext.xaut)).connect(deployer);
  contracts.btcFeed = (await hre.ethers.getContractAt("MockV3Aggregator", ext.btcUsdFeed)).connect(deployer);
  contracts.xauFeed = (await hre.ethers.getContractAt("MockV3Aggregator", ext.xauUsdFeed)).connect(deployer);
  contracts.lifiDiamond = (await hre.ethers.getContractAt("MockLiFiDiamond", ext.lifiDiamond)).connect(deployer);

  log.success("Connected to all contracts");
}

// ============ Price Manipulation Module ============

async function getPrices() {
  const btcData = await contracts.btcFeed.latestRoundData();
  const xauData = await contracts.xauFeed.latestRoundData();

  const btcPrice = Number(btcData[1]) / 1e8;
  const xauPrice = Number(xauData[1]) / 1e8;

  return { btcPrice, xauPrice };
}

async function setBtcPrice(priceUsd) {
  const priceWith8Dec = BigInt(Math.round(priceUsd * 1e8));
  const tx = await contracts.btcFeed.updateAnswer(priceWith8Dec);
  await tx.wait();
  log.success(`BTC price set to $${priceUsd.toLocaleString()}`);
}

async function setGoldPrice(priceUsd) {
  const priceWith8Dec = BigInt(Math.round(priceUsd * 1e8));
  const tx = await contracts.xauFeed.updateAnswer(priceWith8Dec);
  await tx.wait();
  log.success(`Gold price set to $${priceUsd.toLocaleString()}`);
}

async function applyPercentChange(btcPercent, goldPercent) {
  const { btcPrice, xauPrice } = await getPrices();

  const newBtc = btcPrice * (1 + btcPercent / 100);
  const newGold = xauPrice * (1 + goldPercent / 100);

  await setBtcPrice(newBtc);
  await setGoldPrice(newGold);

  return { newBtc, newGold };
}

// ============ Exchange Rate Module ============

function calcForwardRate(priceUsd, assetDecimals) {
  // Returns: how much asset you get per USDC (1e18 scaled)
  const price = BigInt(Math.round(priceUsd));
  return (10n ** BigInt(assetDecimals)) * 10n ** 18n / (price * 10n ** 6n);
}

function calcReverseRate(priceUsd, assetDecimals) {
  // Returns: how much USDC you get per asset (1e18 scaled)
  const price = BigInt(Math.round(priceUsd));
  return price * 10n ** 6n * 10n ** 18n / (10n ** BigInt(assetDecimals));
}

async function syncRatesWithOracles() {
  const { btcPrice, xauPrice } = await getPrices();
  const ext = deployment.externalAddresses;

  // TBTC: 8 decimals
  const btcForward = calcForwardRate(btcPrice, 8);
  const btcReverse = calcReverseRate(btcPrice, 8);
  await (await contracts.lifiDiamond.setExchangeRate(ext.usdc, ext.tbtc, btcForward)).wait();
  await (await contracts.lifiDiamond.setExchangeRate(ext.tbtc, ext.usdc, btcReverse)).wait();

  // XAUt (Tether Gold): 6 decimals
  const goldForward = calcForwardRate(xauPrice, 6);
  const goldReverse = calcReverseRate(xauPrice, 6);
  await (await contracts.lifiDiamond.setExchangeRate(ext.usdc, ext.xaut, goldForward)).wait();
  await (await contracts.lifiDiamond.setExchangeRate(ext.xaut, ext.usdc, goldReverse)).wait();

  log.success(`Exchange rates synced: BTC=$${btcPrice.toLocaleString()}, Gold=$${xauPrice.toLocaleString()}`);
}

// ============ Treasury Module ============

// Helper to convert bytes32 to string
function bytes32ToString(bytes32) {
  try {
    return hre.ethers.decodeBytes32String(bytes32);
  } catch {
    return bytes32.replace(/\x00/g, '');
  }
}

async function getVaultBreakdown() {
  // Get dynamic assets from the new Treasury interface
  const [keys, assetList] = await contracts.treasury.getAllAssets();
  const rosePrice = await contracts.treasury.rosePrice();
  const needsRebalance = await contracts.treasury.needsRebalance();
  const hardAssetValueUSD = await contracts.treasury.hardAssetValueUSD();
  const circulatingSupply = await contracts.treasury.circulatingSupply();

  // Fetch breakdown for each active asset
  const assets = [];
  for (let i = 0; i < keys.length; i++) {
    if (!assetList[i].active) continue;

    const key = bytes32ToString(keys[i]);
    const breakdown = await contracts.treasury.getAssetBreakdown(keys[i]);
    // breakdown returns: (token, balance, valueUSD, targetBps, actualBps, active)

    assets.push({
      key,
      token: breakdown[0],
      balance: breakdown[1],
      valueUSD: Number(breakdown[2]) / 1e6,
      targetBps: Number(breakdown[3]),
      actualBps: Number(breakdown[4]),
      active: breakdown[5],
    });
  }

  // Extract individual asset values for backwards compatibility
  const btcAsset = assets.find(a => a.key === 'BTC');
  const goldAsset = assets.find(a => a.key === 'GOLD');
  const stableAsset = assets.find(a => a.key === 'STABLE');
  const roseAsset = assets.find(a => a.key === 'ROSE');

  return {
    // Dynamic assets array
    assets,
    // Legacy fields for backwards compatibility
    btcValue: btcAsset?.valueUSD || 0,
    goldValue: goldAsset?.valueUSD || 0,
    usdcValue: stableAsset?.valueUSD || 0,
    roseValue: roseAsset?.valueUSD || 0,
    totalHardAssets: Number(hardAssetValueUSD) / 1e6,
    rosePrice: Number(rosePrice) / 1e6,
    circulatingSupply: Number(circulatingSupply) / 1e18,
    needsRebalance,
  };
}

async function displayVaultBreakdown() {
  const v = await getVaultBreakdown();

  log.header("=== VAULT BREAKDOWN ===");

  // Display each asset dynamically
  const DRIFT_THRESHOLD = 500; // 5% in basis points
  for (const asset of v.assets) {
    const targetPct = (asset.targetBps / 100).toFixed(1);
    const actualPct = (asset.actualBps / 100).toFixed(1);
    const driftBps = Math.abs(asset.actualBps - asset.targetBps);
    const driftIndicator = driftBps > DRIFT_THRESHOLD ? colors.yellow + " !" : "";

    // Format display name
    const displayName = {
      BTC: "Bitcoin",
      GOLD: "Gold (XAUt)",
      STABLE: "USDC",
      ROSE: "ROSE",
    }[asset.key] || asset.key;

    console.log(`  ${displayName.padEnd(12)} $${asset.valueUSD.toLocaleString(undefined, { minimumFractionDigits: 2 }).padStart(14)}  (${actualPct}% / ${targetPct}% target)${driftIndicator}${colors.reset}`);
  }

  console.log(`  ${"─".repeat(50)}`);
  console.log(`  ${colors.bright}Total Hard Assets: $${v.totalHardAssets.toLocaleString(undefined, { minimumFractionDigits: 2 })}${colors.reset}`);
  console.log(`  ${colors.cyan}ROSE Price:        $${v.rosePrice.toFixed(6)}${colors.reset}`);
  console.log(`  Circulating:      ${v.circulatingSupply.toLocaleString()} ROSE`);
  console.log(`  Needs Rebalance:  ${v.needsRebalance ? colors.yellow + "YES" : colors.green + "NO"}${colors.reset}`);
}

async function deposit(usdcAmount) {
  const amount = hre.ethers.parseUnits(usdcAmount.toString(), 6);

  // Check USDC balance
  const balance = await contracts.usdc.balanceOf(deployer.address);
  if (balance < amount) {
    log.warn(`Insufficient USDC. Have: ${hre.ethers.formatUnits(balance, 6)}, Need: ${usdcAmount}`);
    log.info("Minting additional USDC...");
    await (await contracts.usdc.mint(deployer.address, amount - balance + 10n ** 6n)).wait();
  }

  // Approve treasury
  await (await contracts.usdc.approve(contracts.treasury.target, amount)).wait();

  // Get ROSE price before
  const priceBefore = await contracts.treasury.rosePrice();
  const roseBalBefore = await contracts.roseToken.balanceOf(deployer.address);

  // Deposit
  const tx = await contracts.treasury.deposit(amount);
  await tx.wait();

  const roseBalAfter = await contracts.roseToken.balanceOf(deployer.address);
  const roseMinted = roseBalAfter - roseBalBefore;

  log.success(`Deposited ${usdcAmount} USDC`);
  log.info(`ROSE minted: ${hre.ethers.formatUnits(roseMinted, 18)} ROSE`);
  log.info(`ROSE price: $${hre.ethers.formatUnits(priceBefore, 6)}`);
}

async function redeem(roseAmount) {
  const amount = hre.ethers.parseUnits(roseAmount.toString(), 18);

  // Check ROSE balance
  const balance = await contracts.roseToken.balanceOf(deployer.address);
  if (balance < amount) {
    log.error(`Insufficient ROSE. Have: ${hre.ethers.formatUnits(balance, 18)}, Need: ${roseAmount}`);
    return;
  }

  // Approve treasury to burn ROSE (required for redemption)
  await (await contracts.roseToken.approve(contracts.treasury.target, amount)).wait();

  // Get USDC balance before
  const usdcBefore = await contracts.usdc.balanceOf(deployer.address);
  const priceBefore = await contracts.treasury.rosePrice();

  // Redeem
  const tx = await contracts.treasury.redeem(amount);
  await tx.wait();

  const usdcAfter = await contracts.usdc.balanceOf(deployer.address);
  const usdcReceived = usdcAfter - usdcBefore;

  log.success(`Redeemed ${roseAmount} ROSE`);
  log.info(`USDC received: ${hre.ethers.formatUnits(usdcReceived, 6)} USDC`);
  log.info(`ROSE price at redemption: $${hre.ethers.formatUnits(priceBefore, 6)}`);
}

async function forceRebalance() {
  log.info("Triggering force rebalance...");

  const vaultBefore = await getVaultBreakdown();

  const tx = await contracts.treasury.forceRebalance();
  const receipt = await tx.wait();

  const vaultAfter = await getVaultBreakdown();

  log.success(`Rebalance complete! Gas used: ${receipt.gasUsed.toString()}`);
  log.info(`NAV before: $${vaultBefore.rosePrice.toFixed(6)} -> after: $${vaultAfter.rosePrice.toFixed(6)}`);
}

async function sendRoseToTreasury(roseAmount) {
  const amount = hre.ethers.parseUnits(roseAmount.toString(), 18);

  const balance = await contracts.roseToken.balanceOf(deployer.address);
  if (balance < amount) {
    log.error(`Insufficient ROSE. Have: ${hre.ethers.formatUnits(balance, 18)}, Need: ${roseAmount}`);
    return;
  }

  const treasuryBefore = await contracts.roseToken.balanceOf(contracts.treasury.target);
  await (await contracts.roseToken.transfer(contracts.treasury.target, amount)).wait();
  const treasuryAfter = await contracts.roseToken.balanceOf(contracts.treasury.target);

  log.success(`Sent ${roseAmount} ROSE to treasury`);
  log.info(`Treasury ROSE: ${hre.ethers.formatUnits(treasuryBefore, 18)} -> ${hre.ethers.formatUnits(treasuryAfter, 18)}`);
}

async function withdrawRoseFromTreasury(roseAmount) {
  const amount = hre.ethers.parseUnits(roseAmount.toString(), 18);

  const treasuryBalance = await contracts.roseToken.balanceOf(contracts.treasury.target);
  if (treasuryBalance < amount) {
    log.error(`Insufficient ROSE in treasury. Have: ${hre.ethers.formatUnits(treasuryBalance, 18)}, Need: ${roseAmount}`);
    return;
  }

  const deployerBefore = await contracts.roseToken.balanceOf(deployer.address);
  // Uses treasury.spendRose() - requires deployer to be owner
  await (await contracts.treasury.spendRose(deployer.address, amount, "simulation withdrawal")).wait();
  const deployerAfter = await contracts.roseToken.balanceOf(deployer.address);

  log.success(`Withdrew ${roseAmount} ROSE from treasury`);
  log.info(`Deployer ROSE: ${hre.ethers.formatUnits(deployerBefore, 18)} -> ${hre.ethers.formatUnits(deployerAfter, 18)}`);
}

// ============ Task Module ============

// Get passport signature from backend signer API
async function getPassportSignature(address, action) {
  try {
    const response = await fetch(`${SIGNER_API_URL}/api/passport/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, action }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Passport verification failed: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    // Returns: { address, action, score, threshold, expiry, signature }
    return { expiry: data.expiry, signature: data.signature };
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error(`Backend signer not running at ${SIGNER_API_URL}. Start it or set PASSPORT_SIGNER_URL.`);
    }
    throw err;
  }
}

// Get reputation signature from backend signer API (for governance deposit)
async function getReputationSignature(address) {
  try {
    const response = await fetch(`${SIGNER_API_URL}/api/governance/reputation-signed/${address}`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Reputation attestation failed: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    // Returns: { address, reputation, expiry, signature }
    return { reputation: data.reputation, expiry: data.expiry, signature: data.signature };
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error(`Backend signer not running at ${SIGNER_API_URL}. Start it or set PASSPORT_SIGNER_URL.`);
    }
    throw err;
  }
}

async function createTask(title, valueRose) {
  const value = hre.ethers.parseUnits(valueRose.toString(), 18);

  // Check ROSE balance
  const balance = await contracts.roseToken.balanceOf(deployer.address);
  if (balance < value) {
    log.warn(`Insufficient ROSE. Minting ${valueRose} ROSE...`);
    // Need to deposit USDC to get ROSE
    const rosePrice = await contracts.treasury.rosePrice();
    const usdcNeeded = (value * rosePrice / 10n ** 18n) + 10n ** 6n;
    await (await contracts.usdc.mint(deployer.address, usdcNeeded)).wait();
    await (await contracts.usdc.approve(contracts.treasury.target, usdcNeeded)).wait();
    await (await contracts.treasury.deposit(usdcNeeded)).wait();
  }

  // Approve marketplace
  await (await contracts.roseToken.approve(contracts.marketplace.target, value)).wait();

  // Get signature from backend signer API
  const { expiry, signature } = await getPassportSignature(deployer.address, "createTask");
  const tx = await contracts.marketplace.createTask(
    title,
    value,
    "ipfs://QmSimulationTask",
    true, // githubIntegration
    expiry,
    signature
  );
  const receipt = await tx.wait();

  // Extract taskId from event
  const event = receipt.logs.find((log) => log.fragment?.name === "TaskCreated");
  const taskId = event?.args?.[0];

  log.success(`Task created: ID=${taskId}, Value=${valueRose} ROSE`);
  return taskId;
}

async function runFullTaskCycle(valueRose) {
  log.header("=== RUNNING FULL TASK CYCLE ===");

  const value = hre.ethers.parseUnits(valueRose.toString(), 18);
  const stakeValue = value / 10n;

  // Load wallets from env vars - all must have valid Gitcoin Passport scores
  // Contract requires: customer != stakeholder != worker
  const customerKey = process.env.CUSTOMER_PRIVATE_KEY;
  const stakeholderKey = process.env.STAKEHOLDER_PRIVATE_KEY;
  const workerKey = process.env.WORKER_PRIVATE_KEY;

  if (!customerKey || !stakeholderKey || !workerKey) {
    log.error("Task operations require wallets with Gitcoin Passport scores.");
    log.error("Set env vars: CUSTOMER_PRIVATE_KEY, STAKEHOLDER_PRIVATE_KEY, WORKER_PRIVATE_KEY");
    log.warn("All three addresses must be different.");
    throw new Error("Missing required private key env vars");
  }

  const customer = new hre.ethers.Wallet(customerKey, hre.ethers.provider);
  const stakeholder = new hre.ethers.Wallet(stakeholderKey, hre.ethers.provider);
  const worker = new hre.ethers.Wallet(workerKey, hre.ethers.provider);

  // Validate addresses are different
  const addresses = [customer.address, stakeholder.address, worker.address];
  if (new Set(addresses).size !== 3) {
    log.error("customer, stakeholder, and worker must be different addresses");
    throw new Error("Duplicate addresses detected");
  }

  log.info(`Customer: ${customer.address}`);
  log.info(`Stakeholder: ${stakeholder.address}`);
  log.info(`Worker: ${worker.address}`);

  // Check ETH balances and fund if needed (deployer funds all wallets)
  log.dim("Checking wallet balances...");
  const minGas = hre.ethers.parseEther("0.005");

  for (const [name, wallet] of [["customer", customer], ["stakeholder", stakeholder], ["worker", worker]]) {
    const ethBal = await hre.ethers.provider.getBalance(wallet.address);
    if (ethBal < minGas) {
      log.dim(`Funding ${name} with ETH...`);
      await (await deployer.sendTransaction({ to: wallet.address, value: minGas })).wait();
    }
  }

  // Fund customer with ROSE if needed
  const customerRose = await contracts.roseToken.balanceOf(customer.address);
  if (customerRose < value) {
    log.dim("Funding customer with ROSE...");
    const rosePrice = await contracts.treasury.rosePrice();
    const usdcForRose = (value * 2n * rosePrice / 10n ** 18n) + 10n ** 6n;
    await (await contracts.usdc.mint(deployer.address, usdcForRose)).wait();
    await (await contracts.usdc.approve(contracts.treasury.target, usdcForRose)).wait();
    await (await contracts.treasury.deposit(usdcForRose)).wait();
    await (await contracts.roseToken.transfer(customer.address, value + value / 10n)).wait();
  }

  // Stakeholder needs vROSE (deposit ROSE to governance if needed)
  const stakeholderVRose = await contracts.vRose.balanceOf(stakeholder.address);
  if (stakeholderVRose < stakeValue) {
    log.dim("Stakeholder needs vROSE, depositing to governance...");
    const needed = stakeValue * 2n;
    const stakeholderRose = await contracts.roseToken.balanceOf(stakeholder.address);
    if (stakeholderRose < needed) {
      await (await contracts.roseToken.transfer(stakeholder.address, needed)).wait();
    }
    await (await contracts.roseToken.connect(stakeholder).approve(contracts.governance.target, needed)).wait();
    const { reputation, expiry: repExpiry, signature: repSig } = await getReputationSignature(stakeholder.address);
    await (await contracts.governance.connect(stakeholder).deposit(needed, reputation, repExpiry, repSig)).wait();
  }

  // Approvals
  await (await contracts.roseToken.connect(customer).approve(contracts.marketplace.target, value)).wait();
  await (await contracts.vRose.connect(stakeholder).approve(contracts.marketplace.target, stakeValue)).wait();

  // 1. Create task
  log.dim("Step 1: Creating task...");
  const { expiry: createExpiry, signature: createSig } = await getPassportSignature(customer.address, "createTask");
  const createTx = await contracts.marketplace.connect(customer).createTask(
    `Simulation Task ${Date.now()}`,
    value,
    "ipfs://QmSimulation",
    true, // githubIntegration
    createExpiry,
    createSig
  );
  const createReceipt = await createTx.wait();
  const taskId = createReceipt.logs.find((l) => l.fragment?.name === "TaskCreated")?.args?.[0];
  log.success(`Task created: ID=${taskId}`);

  // 2. Stakeholder stakes
  log.dim("Step 2: Stakeholder staking...");
  const { expiry: stakeExpiry, signature: stakeSig } = await getPassportSignature(stakeholder.address, "stake");
  await (await contracts.marketplace.connect(stakeholder).stakeholderStake(taskId, stakeValue, stakeExpiry, stakeSig)).wait();
  log.success("Stakeholder staked");

  // 3. Worker claims
  log.dim("Step 3: Worker claiming...");
  const { expiry: claimExpiry, signature: claimSig } = await getPassportSignature(worker.address, "claim");
  await (await contracts.marketplace.connect(worker).claimTask(taskId, claimExpiry, claimSig)).wait();
  log.success("Worker claimed task");

  // 4. Worker completes
  log.dim("Step 4: Marking complete...");
  await (await contracts.marketplace.connect(worker).markTaskCompleted(taskId, "https://github.com/sim/pr")).wait();
  log.success("Task marked complete");

  // 5. Approvals
  log.dim("Step 5: Approving...");
  await (await contracts.marketplace.connect(customer).approveCompletionByCustomer(taskId)).wait();
  await (await contracts.marketplace.connect(stakeholder).approveCompletionByStakeholder(taskId)).wait();
  log.success("Both parties approved");

  // 6. Accept payment
  log.dim("Step 6: Accepting payment...");
  const workerBalBefore = await contracts.roseToken.balanceOf(worker.address);
  await (await contracts.marketplace.connect(worker).acceptPayment(taskId)).wait();
  const workerBalAfter = await contracts.roseToken.balanceOf(worker.address);
  const earned = workerBalAfter - workerBalBefore;
  log.success(`Payment accepted! Worker earned: ${hre.ethers.formatUnits(earned, 18)} ROSE`);

  log.header("=== TASK CYCLE COMPLETE ===");
  return taskId;
}

/**
 * Task states for partial cycle:
 * 1 = StakeholderRequired (task created, waiting for stakeholder)
 * 2 = Open (stakeholder staked, waiting for worker to claim)
 * 3 = InProgress (worker claimed, working)
 * 4 = Completed (work done, waiting for approvals)
 * 5 = ApprovedPendingPayment (approved, waiting for payment)
 * 6 = Closed (payment complete - full cycle)
 */
async function runPartialTaskCycle(options = {}) {
  const {
    title = `Partial Task ${Date.now()}`,
    description = "ipfs://QmbpZuPm95A2vv7gqXqNUtKPfgqbQrsPsDcyQtmPCgGNqK",
    amount = 100,
    stopAtState = 2, // Default: Open (waiting for worker)
  } = options;

  const stateNames = {
    1: "StakeholderRequired",
    2: "Open",
    3: "InProgress",
    4: "Completed",
    5: "ApprovedPendingPayment",
    6: "Closed",
  };

  log.header(`=== PARTIAL TASK: Stop at ${stateNames[stopAtState]} ===`);

  const value = hre.ethers.parseUnits(amount.toString(), 18);
  const stakeValue = value / 10n;

  // Load wallets from env vars
  const customerKey = process.env.CUSTOMER_PRIVATE_KEY;
  const stakeholderKey = process.env.STAKEHOLDER_PRIVATE_KEY;
  const workerKey = process.env.WORKER_PRIVATE_KEY;

  if (!customerKey || !stakeholderKey || !workerKey) {
    log.error("Task operations require wallets with Gitcoin Passport scores.");
    log.error("Set env vars: CUSTOMER_PRIVATE_KEY, STAKEHOLDER_PRIVATE_KEY, WORKER_PRIVATE_KEY");
    throw new Error("Missing required private key env vars");
  }

  const customer = new hre.ethers.Wallet(customerKey, hre.ethers.provider);
  const stakeholder = new hre.ethers.Wallet(stakeholderKey, hre.ethers.provider);
  const worker = new hre.ethers.Wallet(workerKey, hre.ethers.provider);

  // Validate addresses are different
  const addresses = [customer.address, stakeholder.address, worker.address];
  if (new Set(addresses).size !== 3) {
    log.error("customer, stakeholder, and worker must be different addresses");
    throw new Error("Duplicate addresses detected");
  }

  log.info(`Title: ${title}`);
  log.info(`Description: ${description}`);
  log.info(`Amount: ${amount} ROSE`);
  log.dim(`Customer: ${customer.address}`);
  log.dim(`Stakeholder: ${stakeholder.address}`);
  log.dim(`Worker: ${worker.address}`);

  // Fund wallets with ETH if needed
  const minGas = hre.ethers.parseEther("0.005");
  for (const [name, wallet] of [["customer", customer], ["stakeholder", stakeholder], ["worker", worker]]) {
    const ethBal = await hre.ethers.provider.getBalance(wallet.address);
    if (ethBal < minGas) {
      log.dim(`Funding ${name} with ETH...`);
      await (await deployer.sendTransaction({ to: wallet.address, value: minGas })).wait();
    }
  }

  // Fund customer with ROSE if needed
  const customerRose = await contracts.roseToken.balanceOf(customer.address);
  if (customerRose < value) {
    log.dim("Funding customer with ROSE...");
    const rosePrice = await contracts.treasury.rosePrice();
    const usdcForRose = (value * 2n * rosePrice / 10n ** 18n) + 10n ** 6n;
    await (await contracts.usdc.mint(deployer.address, usdcForRose)).wait();
    await (await contracts.usdc.approve(contracts.treasury.target, usdcForRose)).wait();
    await (await contracts.treasury.deposit(usdcForRose)).wait();
    await (await contracts.roseToken.transfer(customer.address, value + value / 10n)).wait();
  }

  // Approvals for customer
  await (await contracts.roseToken.connect(customer).approve(contracts.marketplace.target, value)).wait();

  // Step 1: Create task
  log.dim("Step 1: Creating task...");
  const { expiry: createExpiry, signature: createSig } = await getPassportSignature(customer.address, "createTask");
  const createTx = await contracts.marketplace.connect(customer).createTask(
    title,
    value,
    description,
    true, // githubIntegration
    createExpiry,
    createSig
  );
  const createReceipt = await createTx.wait();
  const taskId = createReceipt.logs.find((l) => l.fragment?.name === "TaskCreated")?.args?.[0];
  log.success(`Task created: ID=${taskId}`);

  if (stopAtState === 1) {
    log.header(`=== STOPPED AT: StakeholderRequired (Task ID: ${taskId}) ===`);
    return taskId;
  }

  // Fund stakeholder with vROSE if needed
  const stakeholderVRose = await contracts.vRose.balanceOf(stakeholder.address);
  if (stakeholderVRose < stakeValue) {
    log.dim("Stakeholder needs vROSE, depositing to governance...");
    const needed = stakeValue * 2n;
    const stakeholderRose = await contracts.roseToken.balanceOf(stakeholder.address);
    if (stakeholderRose < needed) {
      await (await contracts.roseToken.transfer(stakeholder.address, needed)).wait();
    }
    await (await contracts.roseToken.connect(stakeholder).approve(contracts.governance.target, needed)).wait();
    const { reputation, expiry: repExpiry, signature: repSig } = await getReputationSignature(stakeholder.address);
    await (await contracts.governance.connect(stakeholder).deposit(needed, reputation, repExpiry, repSig)).wait();
  }
  await (await contracts.vRose.connect(stakeholder).approve(contracts.marketplace.target, stakeValue)).wait();

  // Step 2: Stakeholder stakes
  log.dim("Step 2: Stakeholder staking...");
  const { expiry: stakeExpiry, signature: stakeSig } = await getPassportSignature(stakeholder.address, "stake");
  await (await contracts.marketplace.connect(stakeholder).stakeholderStake(taskId, stakeValue, stakeExpiry, stakeSig)).wait();
  log.success("Stakeholder staked");

  if (stopAtState === 2) {
    log.header(`=== STOPPED AT: Open (Task ID: ${taskId}) ===`);
    log.info("Waiting for worker to claim task");
    return taskId;
  }

  // Step 3: Worker claims
  log.dim("Step 3: Worker claiming...");
  const { expiry: claimExpiry, signature: claimSig } = await getPassportSignature(worker.address, "claim");
  await (await contracts.marketplace.connect(worker).claimTask(taskId, claimExpiry, claimSig)).wait();
  log.success("Worker claimed task");

  if (stopAtState === 3) {
    log.header(`=== STOPPED AT: InProgress (Task ID: ${taskId}) ===`);
    log.info("Worker is working on task");
    return taskId;
  }

  // Step 4: Worker completes
  log.dim("Step 4: Marking complete...");
  await (await contracts.marketplace.connect(worker).markTaskCompleted(taskId, "https://github.com/partial/pr")).wait();
  log.success("Task marked complete");

  if (stopAtState === 4) {
    log.header(`=== STOPPED AT: Completed (Task ID: ${taskId}) ===`);
    log.info("Waiting for customer and stakeholder approval");
    return taskId;
  }

  // Step 5: Approvals
  log.dim("Step 5: Approving...");
  await (await contracts.marketplace.connect(customer).approveCompletionByCustomer(taskId)).wait();
  await (await contracts.marketplace.connect(stakeholder).approveCompletionByStakeholder(taskId)).wait();
  log.success("Both parties approved");

  if (stopAtState === 5) {
    log.header(`=== STOPPED AT: ApprovedPendingPayment (Task ID: ${taskId}) ===`);
    log.info("Waiting for worker to accept payment");
    return taskId;
  }

  // Step 6: Accept payment
  log.dim("Step 6: Accepting payment...");
  const workerBalBefore = await contracts.roseToken.balanceOf(worker.address);
  await (await contracts.marketplace.connect(worker).acceptPayment(taskId)).wait();
  const workerBalAfter = await contracts.roseToken.balanceOf(worker.address);
  const earned = workerBalAfter - workerBalBefore;
  log.success(`Payment accepted! Worker earned: ${hre.ethers.formatUnits(earned, 18)} ROSE`);

  log.header(`=== STOPPED AT: Closed (Task ID: ${taskId}) ===`);
  return taskId;
}

// ============ Utility Module ============

async function mintTokens(token, amount) {
  let contract, decimals, name;
  switch (token.toLowerCase()) {
    case "usdc":
      contract = contracts.usdc;
      decimals = 6;
      name = "USDC";
      break;
    case "tbtc":
      contract = contracts.tbtc;
      decimals = 8;
      name = "TBTC";
      break;
    case "xaut":
    case "gold":
      contract = contracts.xaut;
      decimals = 6;
      name = "XAUt";
      break;
    default:
      log.error(`Unknown token: ${token}. Valid options: usdc, tbtc, xaut/gold`);
      return;
  }

  const amountParsed = hre.ethers.parseUnits(amount.toString(), decimals);
  await (await contract.mint(deployer.address, amountParsed)).wait();
  log.success(`Minted ${amount} ${name} to ${deployer.address}`);
}

async function fundLiFi() {
  const ext = deployment.externalAddresses;
  log.info("Funding LiFi Diamond with liquidity...");

  await (await contracts.usdc.mint(ext.lifiDiamond, hre.ethers.parseUnits("10000000", 6))).wait();
  await (await contracts.tbtc.mint(ext.lifiDiamond, hre.ethers.parseUnits("1000", 8))).wait();
  await (await contracts.xaut.mint(ext.lifiDiamond, hre.ethers.parseUnits("100000", 6))).wait();

  log.success("LiFi funded: 10M USDC, 1000 TBTC, 100K XAUt");
}

async function getBalances(address = null) {
  const addr = address || deployer.address;

  const ethBal = await hre.ethers.provider.getBalance(addr);
  const roseBal = await contracts.roseToken.balanceOf(addr);
  const vRoseBal = await contracts.vRose.balanceOf(addr);
  const usdcBal = await contracts.usdc.balanceOf(addr);

  log.header(`=== BALANCES: ${addr.slice(0, 10)}... ===`);
  console.log(`  ETH:   ${hre.ethers.formatEther(ethBal)}`);
  console.log(`  ROSE:  ${hre.ethers.formatUnits(roseBal, 18)}`);
  console.log(`  vROSE: ${hre.ethers.formatUnits(vRoseBal, 18)}`);
  console.log(`  USDC:  ${hre.ethers.formatUnits(usdcBal, 6)}`);
}

// ============ Quick Scenarios ============

async function scenarioBullMarket() {
  log.header("=== BULL MARKET SCENARIO ===");
  log.info("BTC +50%, Gold +20%");

  const before = await getVaultBreakdown();
  log.dim(`NAV before: $${before.rosePrice.toFixed(6)}`);

  await applyPercentChange(50, 20);
  await syncRatesWithOracles();
  await forceRebalance();

  const after = await getVaultBreakdown();
  const change = ((after.rosePrice - before.rosePrice) / before.rosePrice * 100).toFixed(2);
  log.success(`NAV after: $${after.rosePrice.toFixed(6)} (${change > 0 ? "+" : ""}${change}%)`);
}

async function scenarioBearMarket() {
  log.header("=== BEAR MARKET SCENARIO ===");
  log.info("BTC -40%, Gold -10%");

  const before = await getVaultBreakdown();
  log.dim(`NAV before: $${before.rosePrice.toFixed(6)}`);

  await applyPercentChange(-40, -10);
  await syncRatesWithOracles();

  const after = await getVaultBreakdown();
  const change = ((after.rosePrice - before.rosePrice) / before.rosePrice * 100).toFixed(2);
  log.warn(`NAV after: $${after.rosePrice.toFixed(6)} (${change}%)`);
  log.info(`Needs rebalance: ${after.needsRebalance ? "YES" : "NO"}`);
}

async function scenarioGoldRally() {
  log.header("=== GOLD RALLY SCENARIO ===");
  log.info("BTC flat, Gold +30%");

  const before = await getVaultBreakdown();
  log.dim(`NAV before: $${before.rosePrice.toFixed(6)}`);

  await applyPercentChange(0, 30);
  await syncRatesWithOracles();
  await forceRebalance();

  const after = await getVaultBreakdown();
  const change = ((after.rosePrice - before.rosePrice) / before.rosePrice * 100).toFixed(2);
  log.success(`NAV after: $${after.rosePrice.toFixed(6)} (${change > 0 ? "+" : ""}${change}%)`);
}

async function scenarioCryptoWinter() {
  log.header("=== CRYPTO WINTER SCENARIO ===");
  log.info("BTC -60%, Gold +10% (flight to safety)");

  const before = await getVaultBreakdown();
  log.dim(`NAV before: $${before.rosePrice.toFixed(6)}`);

  await applyPercentChange(-60, 10);
  await syncRatesWithOracles();

  const after = await getVaultBreakdown();
  const change = ((after.rosePrice - before.rosePrice) / before.rosePrice * 100).toFixed(2);
  log.warn(`NAV after: $${after.rosePrice.toFixed(6)} (${change}%)`);
  log.info(`Needs rebalance: ${after.needsRebalance ? "YES - allocation severely drifted" : "NO"}`);
}

async function scenarioDepositRedeem() {
  log.header("=== DEPOSIT & REDEEM TEST ===");

  await displayVaultBreakdown();

  log.info("Depositing 10,000 USDC...");
  await deposit(10000);

  await displayVaultBreakdown();

  log.info("Redeeming 5,000 ROSE...");
  await redeem(5000);

  await displayVaultBreakdown();
}

async function scenarioNavStress() {
  log.header("=== NAV STRESS TEST ===");

  log.info("Step 1: Large deposit (50,000 USDC)");
  await deposit(50000);
  await displayVaultBreakdown();

  log.info("Step 2: Simulating 30% price crash...");
  await applyPercentChange(-30, -15);
  await syncRatesWithOracles();
  await displayVaultBreakdown();

  log.info("Step 3: Attempting redemption of 25,000 ROSE...");
  await redeem(25000);
  await displayVaultBreakdown();
}

// ============ Interactive Menu ============

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function showMainMenu(rl) {
  console.log(`
${colors.bright}${colors.magenta}${"═".repeat(45)}
   ROSE TOKEN SIMULATION CONSOLE
${"═".repeat(45)}${colors.reset}

  1. Price Manipulation
  2. Treasury Operations
  3. Task Operations
  4. Utilities
  5. Quick Scenarios
  0. Exit
`);

  const choice = await prompt(rl, "Select option: ");
  return choice.trim();
}

async function priceMenu(rl) {
  const { btcPrice, xauPrice } = await getPrices();

  console.log(`
${colors.cyan}--- PRICE MANIPULATION ---${colors.reset}
Current: BTC=$${btcPrice.toLocaleString()} | Gold=$${xauPrice.toLocaleString()}

  1. Set BTC price
  2. Set Gold price
  3. Apply % change to both
  4. Sync exchange rates with oracles
  5. View current prices
  0. Back
`);

  const choice = await prompt(rl, "Select: ");

  switch (choice.trim()) {
    case "1":
      const newBtc = await prompt(rl, "Enter BTC price (USD): ");
      await setBtcPrice(parseFloat(newBtc));
      break;
    case "2":
      const newGold = await prompt(rl, "Enter Gold price (USD): ");
      await setGoldPrice(parseFloat(newGold));
      break;
    case "3":
      const btcPct = await prompt(rl, "BTC % change (e.g., -20 or 50): ");
      const goldPct = await prompt(rl, "Gold % change: ");
      await applyPercentChange(parseFloat(btcPct), parseFloat(goldPct));
      break;
    case "4":
      await syncRatesWithOracles();
      break;
    case "5":
      const prices = await getPrices();
      log.info(`BTC: $${prices.btcPrice.toLocaleString()} | Gold: $${prices.xauPrice.toLocaleString()}`);
      break;
  }
}

async function treasuryMenu(rl) {
  console.log(`
${colors.cyan}--- TREASURY OPERATIONS ---${colors.reset}

  1. View vault breakdown
  2. Deposit USDC
  3. Redeem ROSE
  4. Force rebalance
  5. Send ROSE to treasury
  6. Withdraw ROSE from treasury
  0. Back
`);

  const choice = await prompt(rl, "Select: ");

  switch (choice.trim()) {
    case "1":
      await displayVaultBreakdown();
      break;
    case "2":
      const depositAmt = await prompt(rl, "USDC amount to deposit: ");
      await deposit(parseFloat(depositAmt));
      break;
    case "3":
      const redeemAmt = await prompt(rl, "ROSE amount to redeem: ");
      await redeem(parseFloat(redeemAmt));
      break;
    case "4":
      await forceRebalance();
      break;
    case "5":
      const sendAmt = await prompt(rl, "ROSE amount to send to treasury: ");
      await sendRoseToTreasury(parseFloat(sendAmt));
      break;
    case "6":
      const withdrawAmt = await prompt(rl, "ROSE amount to withdraw from treasury: ");
      await withdrawRoseFromTreasury(parseFloat(withdrawAmt));
      break;
  }
}

async function taskMenu(rl) {
  console.log(`
${colors.cyan}--- TASK OPERATIONS ---${colors.reset}

  1. Run full task cycle (create -> payment)
  2. Create single task (just create, no stake)
  3. Create partial task (stop at specific state)
  4. View marketplace stats
  0. Back
`);

  const choice = await prompt(rl, "Select: ");

  switch (choice.trim()) {
    case "1": {
      const cycleValue = await prompt(rl, "Task value in ROSE (default 100): ");
      const cycleCount = await prompt(rl, "How many task cycles? (default 1): ");
      const numCycles = parseInt(cycleCount) || 1;
      const cycleTaskValue = parseFloat(cycleValue) || 100;

      for (let i = 0; i < numCycles; i++) {
        log.info(`\n--- Task Cycle ${i + 1}/${numCycles} ---`);
        await runFullTaskCycle(cycleTaskValue);
      }

      if (numCycles > 1) {
        log.success(`Completed ${numCycles} task cycles`);
      }
      break;
    }
    case "2": {
      const simpleTitle = await prompt(rl, "Task title: ");
      const simpleValue = await prompt(rl, "Task value in ROSE: ");
      await createTask(simpleTitle, parseFloat(simpleValue));
      break;
    }
    case "3": {
      console.log(`
${colors.cyan}Stop at which state?${colors.reset}
  1. StakeholderRequired (task created, waiting for stakeholder)
  2. Open (stakeholder staked, waiting for worker to claim)
  3. InProgress (worker claimed, working)
  4. Completed (work done, waiting for approvals)
  5. ApprovedPendingPayment (approved, waiting for payment)
  6. Closed (payment complete - full cycle)
`);
      const stateChoice = await prompt(rl, "Select state (1-6, default 2): ");
      const stopAtState = parseInt(stateChoice) || 2;

      if (stopAtState < 1 || stopAtState > 6) {
        log.error("Invalid state. Must be 1-6.");
        break;
      }

      const partialTitle = await prompt(rl, "Task title (default: auto-generated): ");
      const partialDesc = await prompt(rl, "IPFS description hash (default: ipfs://QmbpZuPm95A2vv7gqXqNUtKPfgqbQrsPsDcyQtmPCgGNqK): ");
      const partialAmount = await prompt(rl, "Task value in ROSE (default 100): ");
      const partialCycles = await prompt(rl, "How many tasks? (default 1): ");

      const numPartialCycles = parseInt(partialCycles) || 1;

      for (let i = 0; i < numPartialCycles; i++) {
        if (numPartialCycles > 1) {
          log.info(`\n--- Partial Task ${i + 1}/${numPartialCycles} ---`);
        }
        await runPartialTaskCycle({
          title: partialTitle || `Partial Task ${Date.now()}-${i}`,
          description: partialDesc || "ipfs://QmbpZuPm95A2vv7gqXqNUtKPfgqbQrsPsDcyQtmPCgGNqK",
          amount: parseFloat(partialAmount) || 100,
          stopAtState,
        });
      }

      if (numPartialCycles > 1) {
        log.success(`Created ${numPartialCycles} partial tasks`);
      }
      break;
    }
    case "4": {
      const taskCount = await contracts.marketplace.taskCounter();
      log.info(`Total tasks created: ${taskCount}`);
      break;
    }
  }
}

async function utilitiesMenu(rl) {
  console.log(`
${colors.cyan}--- UTILITIES ---${colors.reset}

  1. View balances
  2. Mint mock tokens
  3. Fund LiFi Diamond
  0. Back
`);

  const choice = await prompt(rl, "Select: ");

  switch (choice.trim()) {
    case "1":
      await getBalances();
      break;
    case "2":
      const token = await prompt(rl, "Token (usdc/tbtc/xaut): ");
      const amount = await prompt(rl, "Amount: ");
      await mintTokens(token, parseFloat(amount));
      break;
    case "3":
      await fundLiFi();
      break;
  }
}

async function scenariosMenu(rl) {
  console.log(`
${colors.cyan}--- QUICK SCENARIOS ---${colors.reset}

  1. Bull Market (BTC +50%, Gold +20%)
  2. Bear Market (BTC -40%, Gold -10%)
  3. Gold Rally (Gold +30%, BTC flat)
  4. Crypto Winter (BTC -60%, Gold +10%)
  5. Deposit & Redeem Test
  6. NAV Stress Test
  7. Full Task Cycle
  0. Back
`);

  const choice = await prompt(rl, "Select: ");

  switch (choice.trim()) {
    case "1":
      await scenarioBullMarket();
      break;
    case "2":
      await scenarioBearMarket();
      break;
    case "3":
      await scenarioGoldRally();
      break;
    case "4":
      await scenarioCryptoWinter();
      break;
    case "5":
      await scenarioDepositRedeem();
      break;
    case "6":
      await scenarioNavStress();
      break;
    case "7":
      await runFullTaskCycle(100);
      break;
  }
}

async function runInteractive() {
  const rl = createInterface();

  let running = true;
  while (running) {
    const choice = await showMainMenu(rl);

    switch (choice) {
      case "1":
        await priceMenu(rl);
        break;
      case "2":
        await treasuryMenu(rl);
        break;
      case "3":
        await taskMenu(rl);
        break;
      case "4":
        await utilitiesMenu(rl);
        break;
      case "5":
        await scenariosMenu(rl);
        break;
      case "0":
        running = false;
        break;
      default:
        log.warn("Invalid option");
    }
  }

  rl.close();
  log.success("Goodbye!");
}

// ============ CLI Commands ============

async function runCLI(args) {
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--btc-price" && args[i + 1]) {
      await setBtcPrice(parseFloat(args[++i]));
      await syncRatesWithOracles();
    } else if (arg === "--gold-price" && args[i + 1]) {
      await setGoldPrice(parseFloat(args[++i]));
      await syncRatesWithOracles();
    } else if (arg === "--crash" && args[i + 1]) {
      const pct = -Math.abs(parseFloat(args[++i]));
      await applyPercentChange(pct, pct / 2);
      await syncRatesWithOracles();
    } else if (arg === "--deposit" && args[i + 1]) {
      await deposit(parseFloat(args[++i]));
    } else if (arg === "--redeem" && args[i + 1]) {
      await redeem(parseFloat(args[++i]));
    } else if (arg === "--rebalance") {
      await forceRebalance();
    } else if (arg === "--task" && args[i + 1]) {
      await runFullTaskCycle(parseFloat(args[++i]));
    } else if (arg === "--scenario" && args[i + 1]) {
      const scenario = args[++i].toLowerCase();
      switch (scenario) {
        case "bull":
          await scenarioBullMarket();
          break;
        case "bear":
          await scenarioBearMarket();
          break;
        case "gold-rally":
          await scenarioGoldRally();
          break;
        case "crypto-winter":
          await scenarioCryptoWinter();
          break;
        case "deposit-redeem":
          await scenarioDepositRedeem();
          break;
        case "nav-stress":
          await scenarioNavStress();
          break;
        default:
          log.error(`Unknown scenario: ${scenario}`);
      }
    } else if (arg === "--vault") {
      await displayVaultBreakdown();
    } else if (arg === "--balances") {
      await getBalances();
    } else if (arg === "--prices") {
      const { btcPrice, xauPrice } = await getPrices();
      log.info(`BTC: $${btcPrice.toLocaleString()} | Gold: $${xauPrice.toLocaleString()}`);
    } else if (arg === "--help") {
      console.log(`
ROSE Token Simulation Script

Usage: npx hardhat run scripts/simulate.js --network arbitrumSepolia [-- OPTIONS]

Options:
  --btc-price <USD>      Set BTC price
  --gold-price <USD>     Set Gold price
  --crash <PERCENT>      Apply market crash (e.g., --crash 20 for -20%)
  --deposit <USDC>       Deposit USDC to treasury
  --redeem <ROSE>        Redeem ROSE from treasury
  --rebalance            Force treasury rebalance
  --task <ROSE>          Run full task cycle with given value
  --scenario <NAME>      Run quick scenario (bull, bear, gold-rally, crypto-winter, deposit-redeem, nav-stress)
  --vault                Show vault breakdown
  --balances             Show deployer balances
  --prices               Show current oracle prices
  --help                 Show this help

Environment Variables:
  PASSPORT_SIGNER_URL      Backend signer URL (default: https://signer.rose-token.com)
  CUSTOMER_PRIVATE_KEY     Private key for customer wallet (required for --task)
  STAKEHOLDER_PRIVATE_KEY  Private key for stakeholder wallet (required for --task)
  WORKER_PRIVATE_KEY       Private key for worker wallet (required for --task)

Note: All three wallets must have valid Gitcoin Passport scores and different addresses.

Interactive mode: Run without arguments to enter interactive menu.
`);
      return;
    }
  }
}

// ============ Main Entry Point ============

async function main() {
  console.log(`
${colors.bright}${colors.cyan}
╔═══════════════════════════════════════════════════════╗
║        ROSE TOKEN SIMULATION SCRIPT                   ║
║        Arbitrum Sepolia Testnet                       ║
╚═══════════════════════════════════════════════════════╝
${colors.reset}`);

  // Initialize deployer from CUSTOMER_PRIVATE_KEY (also used as customer in task cycles)
  const customerKey = process.env.CUSTOMER_PRIVATE_KEY;
  if (!customerKey) {
    log.error("CUSTOMER_PRIVATE_KEY env var required");
    process.exit(1);
  }
  deployer = new hre.ethers.Wallet(customerKey, hre.ethers.provider);
  log.info(`Deployer/Customer: ${deployer.address}`);

  await loadDeployment();
  await loadContracts();

  // Check for CLI arguments (after --)
  const dashDashIndex = process.argv.indexOf("--");
  const hasCliArgs = dashDashIndex !== -1 && process.argv.length > dashDashIndex + 1;

  if (hasCliArgs) {
    const cliArgs = process.argv.slice(dashDashIndex + 1);
    await runCLI(cliArgs);
  } else {
    await runInteractive();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
