const hre = require("hardhat");
const fs = require("fs");

// ============ CLI Flags ============
const USE_MOCKS = true;

// ============ Network Addresses ============
// Mainnet addresses
const MAINNET = {
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  tbtc: "0x6c84a8f1c29108f47a79964b5fe888d4f4d0de40",
  paxg: "0x45804880De22913dAFE09f4980848ECE6EcbAf78",
  btcUsdFeed: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  xauUsdFeed: "0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6",
  swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Uniswap V3
};

// Arbitrum Sepolia testnet addresses (all mocks for reliable CI/CD)
const ARBITRUM_SEPOLIA = {
  usdc: null, // Will deploy mock
  tbtc: null, // Will deploy mock
  paxg: null, // Will deploy mock
  btcUsdFeed: null, // Will deploy mock
  xauUsdFeed: null, // Will deploy mock
  swapRouter: null, // Will deploy mock
};

// Simple mock ERC20 for testnet
const MOCK_TOKEN_ABI = [
  "constructor(string name, string symbol, uint8 decimals)",
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Display deployer's ETH balance
  const initialBalance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer ETH balance:", hre.ethers.formatEther(initialBalance), "ETH");

  // Detect network
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log("Network:", network.name, "Chain ID:", chainId);

  // Select addresses based on network
  let addresses;
  let isTestnet = false;

  if (USE_MOCKS) {
    // Force mock mode (useful for Tenderly forks without state sync)
    addresses = { ...ARBITRUM_SEPOLIA };
    isTestnet = true;
    console.log("⚠️  --use-mocks flag detected: deploying mock oracles/router");
  } else if (chainId === 42161) {
    addresses = MAINNET;
    console.log("Using MAINNET addresses (Arbitrum One)");
  } else if (chainId === 421614) {
    addresses = { ...ARBITRUM_SEPOLIA };
    isTestnet = true;
    console.log("Using ARBITRUM_SEPOLIA addresses (Arbitrum Sepolia testnet - all mocks)");
  } else {
    addresses = { ...ARBITRUM_SEPOLIA };
    isTestnet = true;
    console.log("Unknown network - using ARBITRUM_SEPOLIA addresses as default (testnet mode)");
  }

  // ============ Step 0: Deploy Mock Tokens (Testnet Only) ============
  if (isTestnet) {
    console.log("\n--- Step 0: Deploying Mock Tokens (Testnet) ---");

    const MockToken = await hre.ethers.getContractFactory("MockERC20");

    // Deploy mock USDC for testnet (so we can mint for testing)
    // Circle's USDC exists but doesn't have public mint
    const mockUsdc = await MockToken.deploy("Mock USDC", "USDC", 6);
    await mockUsdc.waitForDeployment();
    addresses.usdc = await mockUsdc.getAddress();
    console.log("Mock USDC deployed to:", addresses.usdc);

    // Mint 1M USDC to deployer for treasury seeding
    const mintAmount = hre.ethers.parseUnits("1000000", 6); // 1,000,000 USDC
    await (await mockUsdc.mint(deployer.address, mintAmount)).wait();
    console.log("Minted 1,000,000 USDC to deployer ✓");

    // Deploy mock TBTC if needed
    if (!addresses.tbtc) {
      const mockTbtc = await MockToken.deploy("Mock TBTC", "TBTC", 8);
      await mockTbtc.waitForDeployment();
      addresses.tbtc = await mockTbtc.getAddress();
      console.log("Mock TBTC deployed to:", addresses.tbtc);
    }

    // Deploy mock PAXG if needed
    if (!addresses.paxg) {
      const mockPaxg = await MockToken.deploy("Mock PAXG", "PAXG", 18);
      await mockPaxg.waitForDeployment();
      addresses.paxg = await mockPaxg.getAddress();
      console.log("Mock PAXG deployed to:", addresses.paxg);
    }

    // Deploy MockV3Aggregator for price feeds (real Chainlink feeds may be stale on testnet)
    console.log("\nDeploying MockV3Aggregators for testnet price feeds...");
    const MockAggregator = await hre.ethers.getContractFactory("MockV3Aggregator");

    // Deploy mock BTC/USD feed (~$60,000 with 8 decimals)
    const mockBtcFeed = await MockAggregator.deploy(8, 6000000000000n);
    await mockBtcFeed.waitForDeployment();
    addresses.btcUsdFeed = await mockBtcFeed.getAddress();
    console.log("Mock BTC/USD feed deployed to:", addresses.btcUsdFeed, "(price: $60,000)");

    // Deploy mock XAU/USD feed (~$2,000 with 8 decimals)
    const mockXauFeed = await MockAggregator.deploy(8, 200000000000n);
    await mockXauFeed.waitForDeployment();
    addresses.xauUsdFeed = await mockXauFeed.getAddress();
    console.log("Mock XAU/USD feed deployed to:", addresses.xauUsdFeed, "(price: $2,000)");

    // Deploy mock ROSE/USD feed ($1.33 with 8 decimals)
    const mockRoseFeed = await MockAggregator.deploy(8, 133000000n);
    await mockRoseFeed.waitForDeployment();
    addresses.roseUsdFeed = await mockRoseFeed.getAddress();
    console.log("Mock ROSE/USD feed deployed to:", addresses.roseUsdFeed, "(price: $1.33)");

    // Deploy MockUniswapV3Router for testnet (real Uniswap has no liquidity for mock tokens)
    console.log("\nDeploying MockUniswapV3Router for testnet...");
    const MockRouter = await hre.ethers.getContractFactory("MockUniswapV3Router");
    const mockRouter = await MockRouter.deploy();
    await mockRouter.waitForDeployment();
    addresses.swapRouter = await mockRouter.getAddress();
    console.log("MockUniswapV3Router deployed to:", addresses.swapRouter);

    // Configure token decimals on the mock router
    await (await mockRouter.setTokenDecimals(addresses.usdc, 6)).wait();
    await (await mockRouter.setTokenDecimals(addresses.tbtc, 8)).wait();
    await (await mockRouter.setTokenDecimals(addresses.paxg, 18)).wait();
    console.log("Token decimals configured on mock router ✓");

    // Set exchange rates to match mock aggregator prices
    // Formula: amountOut = (amountIn * rate) / 1e18
    // For USDC (6 dec) -> Asset swaps: rate = (assetAmount per $1) * 1e18 / 1e6
    //
    // BTC @ $60,000: (1e8 / 60000) * 1e18 / 1e6 = 1.6666e15
    await (await mockRouter.setExchangeRate(addresses.usdc, addresses.tbtc, 1666666666666666n)).wait();
    // Gold @ $2,000: (1e18 / 2000) * 1e18 / 1e6 = 5e26
    await (await mockRouter.setExchangeRate(addresses.usdc, addresses.paxg, 500000000000000000000000000n)).wait();
    console.log("Forward exchange rates (USDC → Asset) configured ✓");

    // Reverse rates: Asset -> USDC (for redemption liquidation)
    // Formula: amountOut = (amountIn * rate) / 1e18
    // For Asset -> USDC swaps: rate = price * 1e6 * 1e18 / 10^assetDecimals
    //
    // BTC @ $60,000: 60000 * 1e6 * 1e18 / 1e8 = 6e20
    await (await mockRouter.setExchangeRate(addresses.tbtc, addresses.usdc, 600000000000000000000n)).wait();
    // Gold @ $2,000: 2000 * 1e6 * 1e18 / 1e18 = 2e9
    await (await mockRouter.setExchangeRate(addresses.paxg, addresses.usdc, 2000000000n)).wait();
    console.log("Reverse exchange rates (Asset → USDC) configured ✓");

    // Fund the mock router with tokens for swaps
    const mockUsdc_router = await hre.ethers.getContractAt("MockERC20", addresses.usdc);
    const mockTbtc_router = await hre.ethers.getContractAt("MockERC20", addresses.tbtc);
    const mockPaxg_router = await hre.ethers.getContractAt("MockERC20", addresses.paxg);

    // Fund with massive liquidity for stress testing redemptions
    await (await mockTbtc_router.mint(addresses.swapRouter, hre.ethers.parseUnits("10000", 8))).wait();      // 10k BTC
    await (await mockPaxg_router.mint(addresses.swapRouter, hre.ethers.parseUnits("1000000", 18))).wait();   // 1M PAXG
    await (await mockUsdc_router.mint(addresses.swapRouter, hre.ethers.parseUnits("1000000000", 6))).wait(); // 1B USDC
    console.log("Mock router funded with liquidity (1B USDC, 10k BTC, 1M PAXG) ✓");

    // Store mockRouter for ROSE configuration after RoseToken deploy
    addresses.mockRouter = mockRouter;
  }

  // ============ Step 1: Deploy RoseToken ============
  console.log("\n--- Step 1: Deploying RoseToken ---");
  const RoseToken = await hre.ethers.getContractFactory("RoseToken");
  // Deploy with deployer as initial authorized (we'll add more later)
  const roseToken = await RoseToken.deploy(deployer.address);
  await roseToken.waitForDeployment();
  const roseTokenAddress = await roseToken.getAddress();
  console.log("RoseToken deployed to:", roseTokenAddress);

  // ============ Step 1a: Deploy vROSE ============
  console.log("\n--- Step 1a: Deploying vROSE ---");
  const VROSE = await hre.ethers.getContractFactory("vROSE");
  const vRose = await VROSE.deploy();
  await vRose.waitForDeployment();
  const vRoseAddress = await vRose.getAddress();
  console.log("vROSE deployed to:", vRoseAddress);

  // ============ Step 1.5: Configure ROSE on Mock Router (Testnet) ============
  if (isTestnet && addresses.mockRouter) {
    console.log("\n--- Step 1.5: Configuring ROSE on Mock Router ---");
    const mockRouter = addresses.mockRouter;

    // Set ROSE decimals
    await (await mockRouter.setTokenDecimals(roseTokenAddress, 18)).wait();

    // ROSE at $1.33
    // USDC → ROSE: 1 USDC = 0.7519 ROSE (rate = 1e30 / 1.33 to handle 6→18 decimal conversion)
    await (await mockRouter.setExchangeRate(addresses.usdc, roseTokenAddress, 751879699248120300751879699248n)).wait();
    // ROSE → USDC: 1 ROSE = 1.33 USDC (rate = 1e6 * 1.33 to handle 18→6 decimal conversion)
    await (await mockRouter.setExchangeRate(roseTokenAddress, addresses.usdc, 1330000n)).wait();
    console.log("ROSE exchange rates configured (USDC ↔ ROSE @ $1.33) ✓");

    // Note: ROSE liquidity for router will be added after treasury deposit
  }

  // ============ Step 2: Deploy RoseTreasury ============
  console.log("\n--- Step 2: Deploying RoseTreasury ---");
  const RoseTreasury = await hre.ethers.getContractFactory("RoseTreasury");
  // New constructor: (roseToken, usdc, swapRouter) - assets added via addAsset()
  const roseTreasury = await RoseTreasury.deploy(
    roseTokenAddress,
    addresses.usdc,
    addresses.swapRouter
  );
  await roseTreasury.waitForDeployment();
  const treasuryAddress = await roseTreasury.getAddress();
  console.log("RoseTreasury deployed to:", treasuryAddress);

  // Register assets with addAsset()
  console.log("Registering treasury assets...");

  // BTC: 30%
  const btcKey = hre.ethers.encodeBytes32String("BTC");
  await (await roseTreasury.addAsset(
    btcKey,
    addresses.tbtc,
    addresses.btcUsdFeed,
    8,    // decimals
    3000  // 30%
  )).wait();
  console.log("  BTC asset registered (30%) ✓");

  // GOLD: 30%
  const goldKey = hre.ethers.encodeBytes32String("GOLD");
  await (await roseTreasury.addAsset(
    goldKey,
    addresses.paxg,
    addresses.xauUsdFeed,
    18,   // decimals
    3000  // 30%
  )).wait();
  console.log("  GOLD asset registered (30%) ✓");

  // STABLE (USDC): 20%
  const stableKey = hre.ethers.encodeBytes32String("STABLE");
  await (await roseTreasury.addAsset(
    stableKey,
    addresses.usdc,
    hre.ethers.ZeroAddress, // No price feed for stablecoin
    6,    // decimals
    2000  // 20%
  )).wait();
  console.log("  STABLE asset registered (20%) ✓");

  // ROSE: 20%
  const roseKey = hre.ethers.encodeBytes32String("ROSE");
  await (await roseTreasury.addAsset(
    roseKey,
    roseTokenAddress,
    hre.ethers.ZeroAddress, // Uses NAV, not price feed
    18,   // decimals
    2000  // 20%
  )).wait();
  console.log("  ROSE asset registered (20%) ✓");

  // Validate allocations sum to 100%
  const validAllocations = await roseTreasury.validateAllocations();
  console.log("  Allocations valid:", validAllocations ? "✓" : "✗");

  // ============ Step 3: Deploy RoseMarketplace ============
  console.log("\n--- Step 3: Deploying RoseMarketplace ---");

  // Get passport signer address from env or use deployer for testing
  let passportSignerAddress = process.env.PASSPORT_SIGNER_ADDRESS;
  if (!passportSignerAddress) {
    // For testnet/local, use deployer address as signer (testing only)
    passportSignerAddress = deployer.address;
    console.log("No PASSPORT_SIGNER_ADDRESS set, using deployer for testing");
  }
  console.log("Passport signer:", passportSignerAddress);

  const RoseMarketplace = await hre.ethers.getContractFactory("RoseMarketplace");
  // Updated: RoseMarketplace now takes (roseToken, daoTreasury, passportSigner)
  const roseMarketplace = await RoseMarketplace.deploy(roseTokenAddress, treasuryAddress, passportSignerAddress);
  await roseMarketplace.waitForDeployment();
  const marketplaceAddress = await roseMarketplace.getAddress();
  console.log("RoseMarketplace deployed to:", marketplaceAddress);

  // ============ Step 3.5: Deploy RoseReputation ============
  console.log("\n--- Step 3.5: Deploying RoseReputation ---");
  const RoseReputation = await hre.ethers.getContractFactory("RoseReputation");
  // Deploy with deployer as temp governance (will update after governance deploys)
  const roseReputation = await RoseReputation.deploy(
    deployer.address,      // temp governance - updated in Step 5
    marketplaceAddress,
    passportSignerAddress
  );
  await roseReputation.waitForDeployment();
  const reputationAddress = await roseReputation.getAddress();
  console.log("RoseReputation deployed to:", reputationAddress);

  // ============ Step 4: Deploy RoseGovernance ============
  console.log("\n--- Step 4: Deploying RoseGovernance ---");
  const RoseGovernance = await hre.ethers.getContractFactory("RoseGovernance");
  const roseGovernance = await RoseGovernance.deploy(
    roseTokenAddress,
    vRoseAddress,
    marketplaceAddress,
    treasuryAddress,
    passportSignerAddress,
    reputationAddress       // 6th parameter: RoseReputation address
  );
  await roseGovernance.waitForDeployment();
  const governanceAddress = await roseGovernance.getAddress();
  console.log("RoseGovernance deployed to:", governanceAddress);

  // ============ Step 5: Wire up authorizations ============
  console.log("\n--- Step 5: Setting up authorizations ---");

  // Authorize Treasury to mint/burn ROSE
  console.log("Authorizing Treasury for mint/burn...");
  const authTreasuryTx = await roseToken.setAuthorized(treasuryAddress, true);
  await authTreasuryTx.wait();
  console.log("Treasury authorized ✓");

  // Authorize Marketplace to mint/burn ROSE
  console.log("Authorizing Marketplace for mint/burn...");
  const authMarketplaceTx = await roseToken.setAuthorized(marketplaceAddress, true);
  await authMarketplaceTx.wait();
  console.log("Marketplace authorized ✓");

  // Authorize Governance to mint/burn ROSE
  console.log("Authorizing Governance for mint/burn...");
  const authGovernanceTx = await roseToken.setAuthorized(governanceAddress, true);
  await authGovernanceTx.wait();
  console.log("Governance authorized ✓");

  // Set marketplace in treasury (for task posting)
  console.log("Setting marketplace in Treasury...");
  const setMarketplaceTx = await roseTreasury.setMarketplace(marketplaceAddress);
  await setMarketplaceTx.wait();
  console.log("Marketplace set in Treasury ✓");

  // Set vROSE governance and marketplace
  console.log("Setting vROSE governance...");
  await (await vRose.setGovernance(governanceAddress)).wait();
  console.log("vROSE governance set ✓");

  console.log("Setting vROSE marketplace...");
  await (await vRose.setMarketplace(marketplaceAddress)).wait();
  console.log("vROSE marketplace set ✓");

  // Set marketplace vROSE and governance references
  console.log("Setting marketplace vROSE token...");
  await (await roseMarketplace.setVRoseToken(vRoseAddress)).wait();
  console.log("Marketplace vROSE set ✓");

  console.log("Setting marketplace governance...");
  await (await roseMarketplace.setGovernance(governanceAddress)).wait();
  console.log("Marketplace governance set ✓");

  // Set reputation's governance to real governance address (was deployer at deploy time)
  console.log("Setting reputation governance...");
  await (await roseReputation.setGovernance(governanceAddress)).wait();
  console.log("Reputation governance set ✓");

  // Set reputation contract in marketplace
  console.log("Setting marketplace reputation...");
  await (await roseMarketplace.setReputation(reputationAddress)).wait();
  console.log("Marketplace reputation set ✓");

  // Set delegation signer for delegated voting (required for castDelegatedVote)
  console.log("Setting delegation signer...");
  await (await roseGovernance.setDelegationSigner(passportSignerAddress)).wait();
  console.log("Delegation signer set to:", passportSignerAddress, "✓");

  // For testnet, set slippage tolerance and seed treasury
  if (isTestnet) {
    // Allocations already set via addAsset() calls above
    console.log("Assets registered with allocations: 30% BTC, 30% Gold, 20% USDC, 20% ROSE");

    // Set slippage tolerance to 100% for testnet (disables slippage check)
    console.log("Setting testnet slippage tolerance (100%)...");
    const setSlippageTx = await roseTreasury.setMaxSlippage(10000); // 100% = 10000 bps
    await setSlippageTx.wait();
    console.log("Slippage tolerance set ✓");

    // ============ Step 5: Seed Treasury & Distribute ROSE ============
    console.log("\n--- Step 5: Seeding Treasury with 1M USDC ---");

    // Get mockUSDC contract reference
    const mockUsdcForDeposit = await hre.ethers.getContractAt("MockERC20", addresses.usdc);

    // Approve treasury to spend deployer's USDC
    console.log("Approving treasury to spend 1M USDC...");
    await (await mockUsdcForDeposit.approve(treasuryAddress, hre.ethers.parseUnits("1000000", 6))).wait();
    console.log("Treasury approved to spend USDC ✓");

    // Deposit 1M USDC into treasury -> receive 1M ROSE (at $1 initial NAV)
    console.log("Depositing 1M USDC into treasury...");
    await (await roseTreasury.deposit(hre.ethers.parseUnits("1000000", 6))).wait();
    console.log("Deposited 1M USDC, received 1M ROSE ✓");

    // Distribute ROSE: 500k to LP, 250k to treasury, 250k stays with deployer
    console.log("Distributing ROSE tokens...");

    // 500k ROSE to mock router (LP liquidity)
    await (await roseToken.transfer(addresses.swapRouter, hre.ethers.parseUnits("500000", 18))).wait();
    console.log("  - 500k ROSE sent to mock LP ✓");

    // 250k ROSE to treasury (ROSE reserve)
    await (await roseToken.transfer(treasuryAddress, hre.ethers.parseUnits("250000", 18))).wait();
    console.log("  - 250k ROSE sent to treasury ✓");

    // 250k ROSE stays with deployer (no action needed)
    console.log("  - 250k ROSE kept by deployer ✓");

    // Log final balances
    const deployerRose = await roseToken.balanceOf(deployer.address);
    const routerRose = await roseToken.balanceOf(addresses.swapRouter);
    const treasuryRose = await roseToken.balanceOf(treasuryAddress);
    console.log("\nROSE Distribution Complete:");
    console.log("  Deployer:", hre.ethers.formatUnits(deployerRose, 18), "ROSE");
    console.log("  Mock LP:", hre.ethers.formatUnits(routerRose, 18), "ROSE");
    console.log("  Treasury:", hre.ethers.formatUnits(treasuryRose, 18), "ROSE");
  }

  // ============ Summary ============
  console.log("\n========================================");
  console.log("        DEPLOYMENT COMPLETE");
  console.log("========================================");
  console.log("RoseToken:       ", roseTokenAddress);
  console.log("vROSE:           ", vRoseAddress);
  console.log("RoseTreasury:    ", treasuryAddress);
  console.log("RoseMarketplace: ", marketplaceAddress);
  console.log("RoseReputation:  ", reputationAddress);
  console.log("RoseGovernance:  ", governanceAddress);
  console.log("========================================");

  // Display final balance and gas consumed
  const finalBalance = await hre.ethers.provider.getBalance(deployer.address);
  const gasUsed = initialBalance - finalBalance;
  console.log("\nDeployment Cost:");
  console.log("ETH used:", hre.ethers.formatEther(gasUsed), "ETH");
  console.log("Final balance:", hre.ethers.formatEther(finalBalance), "ETH");

  // Save deployment output
  const deploymentOutput = {
    network: network.name,
    chainId: chainId,
    isTestnet: isTestnet,
    deployer: deployer.address,
    contracts: {
      roseToken: roseTokenAddress,
      vRose: vRoseAddress,
      roseTreasury: treasuryAddress,
      roseMarketplace: marketplaceAddress,
      roseReputation: reputationAddress,
      roseGovernance: governanceAddress,
    },
    // Legacy field names for backward compatibility with frontend
    tokenAddress: roseTokenAddress,
    vRoseAddress: vRoseAddress,
    treasuryAddress: treasuryAddress,
    marketplaceAddress: marketplaceAddress,
    reputationAddress: reputationAddress,
    governanceAddress: governanceAddress,
    passportSignerAddress: passportSignerAddress,
    externalAddresses: addresses,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(
    "deployment-output.json",
    JSON.stringify(deploymentOutput, null, 2)
  );
  console.log("\nDeployment info saved to deployment-output.json");

  // ============ Post-Deployment Instructions ============
  console.log("\n========================================");
  console.log("     POST-DEPLOYMENT: SEED TREASURY");
  console.log("========================================");
  console.log(`
To seed the treasury with initial capital:

1. Get USDC (or use the deployed mock USDC on testnets)

2. Approve treasury to spend your USDC:
   await usdc.approve("${treasuryAddress}", amount);

3. Deposit to get ROSE (auto-diversifies into RWA):
   await treasury.deposit(amount);

   OR for direct seeding without minting ROSE to yourself:
   Just transfer USDC directly to treasury address.

4. Verify vault status:
   await treasury.getVaultBreakdown();
   await treasury.rosePrice();
`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
