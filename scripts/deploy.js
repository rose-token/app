const hre = require("hardhat");
const fs = require("fs");

// ============ Network Addresses ============
// Mainnet addresses
const MAINNET = {
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  wbtc: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  reth: "0xae78736Cd615f374D3085123A210448E74Fc6393", // Rocket Pool ETH
  paxg: "0x45804880De22913dAFE09f4980848ECE6EcbAf78",
  btcUsdFeed: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  ethUsdFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  xauUsdFeed: "0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6",
  swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Uniswap V3
};

// Sepolia testnet addresses
// NOTE: For testnet, we run in USDC-only mode (no RWA diversification)
const SEPOLIA = {
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Circle's Sepolia USDC
  reth: null, // Will deploy mock (no official rETH on Sepolia)
  // These don't exist on Sepolia - we'll deploy mocks or skip
  wbtc: null, // Will deploy mock
  paxg: null, // Will deploy mock
  // Chainlink Sepolia feeds
  btcUsdFeed: "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
  ethUsdFeed: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  xauUsdFeed: "0xC5981F461d74c46eB4b0CF3f4Ec79f025573B0Ea", // XAU/USD Sepolia
  swapRouter: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E", // Uniswap V3 Sepolia
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
  
  if (chainId === 1) {
    addresses = MAINNET;
    console.log("Using MAINNET addresses");
  } else if (chainId === 11155111) {
    addresses = { ...SEPOLIA };
    isTestnet = true;
    console.log("Using SEPOLIA addresses (testnet mode)");
  } else {
    addresses = { ...SEPOLIA };
    isTestnet = true;
    console.log("Unknown network - using SEPOLIA addresses as default (testnet mode)");
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

    // Mint 10k USDC to deployer for treasury seeding
    const mintAmount = hre.ethers.parseUnits("20000", 6); // 10,000 USDC
    await mockUsdc.mint(deployer.address, mintAmount);
    console.log("Minted 10,000 USDC to deployer ✓");

    // Deploy mock WBTC if needed
    if (!addresses.wbtc) {
      const mockWbtc = await MockToken.deploy("Mock WBTC", "WBTC", 8);
      await mockWbtc.waitForDeployment();
      addresses.wbtc = await mockWbtc.getAddress();
      console.log("Mock WBTC deployed to:", addresses.wbtc);
    }

    // Deploy mock rETH (Rocket Pool ETH)
    if (!addresses.reth) {
      const mockReth = await MockToken.deploy("Mock Rocket Pool ETH", "rETH", 18);
      await mockReth.waitForDeployment();
      addresses.reth = await mockReth.getAddress();
      console.log("Mock rETH deployed to:", addresses.reth);
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

    // Deploy mock ETH/USD feed (~$3,000 with 8 decimals)
    const mockEthFeed = await MockAggregator.deploy(8, 300000000000n);
    await mockEthFeed.waitForDeployment();
    addresses.ethUsdFeed = await mockEthFeed.getAddress();
    console.log("Mock ETH/USD feed deployed to:", addresses.ethUsdFeed, "(price: $3,000)");

    // Deploy mock XAU/USD feed (~$2,000 with 8 decimals)
    const mockXauFeed = await MockAggregator.deploy(8, 200000000000n);
    await mockXauFeed.waitForDeployment();
    addresses.xauUsdFeed = await mockXauFeed.getAddress();
    console.log("Mock XAU/USD feed deployed to:", addresses.xauUsdFeed, "(price: $2,000)");

    // Deploy MockUniswapV3Router for testnet (real Uniswap has no liquidity for mock tokens)
    console.log("\nDeploying MockUniswapV3Router for testnet...");
    const MockRouter = await hre.ethers.getContractFactory("MockUniswapV3Router");
    const mockRouter = await MockRouter.deploy();
    await mockRouter.waitForDeployment();
    addresses.swapRouter = await mockRouter.getAddress();
    console.log("MockUniswapV3Router deployed to:", addresses.swapRouter);

    // Configure token decimals on the mock router
    await mockRouter.setTokenDecimals(addresses.usdc, 6);
    await mockRouter.setTokenDecimals(addresses.wbtc, 8);
    await mockRouter.setTokenDecimals(addresses.reth, 18);
    await mockRouter.setTokenDecimals(addresses.paxg, 18);
    console.log("Token decimals configured on mock router ✓");

    // Set exchange rates to match mock aggregator prices
    // Formula: amountOut = (amountIn * rate) / 1e18
    // For USDC (6 dec) -> Asset swaps: rate = (assetAmount per $1) * 1e18 / 1e6
    //
    // BTC @ $60,000: (1e8 / 60000) * 1e18 / 1e6 = 1.6666e15
    await mockRouter.setExchangeRate(addresses.usdc, addresses.wbtc, 1666666666666666n);
    // ETH @ $3,000: (1e18 / 3000) * 1e18 / 1e6 = 3.33e26
    await mockRouter.setExchangeRate(addresses.usdc, addresses.reth, 333333333333333333333333333n);
    // Gold @ $2,000: (1e18 / 2000) * 1e18 / 1e6 = 5e26
    await mockRouter.setExchangeRate(addresses.usdc, addresses.paxg, 500000000000000000000000000n);
    console.log("Exchange rates configured on mock router ✓");

    // Fund the mock router with tokens for swaps
    const mockUsdc_router = await hre.ethers.getContractAt("MockERC20", addresses.usdc);
    const mockWbtc_router = await hre.ethers.getContractAt("MockERC20", addresses.wbtc);
    const mockReth_router = await hre.ethers.getContractAt("MockERC20", addresses.reth);
    const mockPaxg_router = await hre.ethers.getContractAt("MockERC20", addresses.paxg);

    await mockWbtc_router.mint(addresses.swapRouter, hre.ethers.parseUnits("1000", 8));
    await mockReth_router.mint(addresses.swapRouter, hre.ethers.parseUnits("100000", 18));
    await mockPaxg_router.mint(addresses.swapRouter, hre.ethers.parseUnits("100000", 18));
    await mockUsdc_router.mint(addresses.swapRouter, hre.ethers.parseUnits("10000000", 6));
    console.log("Mock router funded with liquidity ✓");
  }

  // ============ Step 1: Deploy RoseToken ============
  console.log("\n--- Step 1: Deploying RoseToken ---");
  const RoseToken = await hre.ethers.getContractFactory("RoseToken");
  // Deploy with deployer as initial authorized (we'll add more later)
  const roseToken = await RoseToken.deploy(deployer.address);
  await roseToken.waitForDeployment();
  const roseTokenAddress = await roseToken.getAddress();
  console.log("RoseToken deployed to:", roseTokenAddress);

  // ============ Step 2: Deploy RoseTreasury ============
  console.log("\n--- Step 2: Deploying RoseTreasury ---");
  const RoseTreasury = await hre.ethers.getContractFactory("RoseTreasury");
  const roseTreasury = await RoseTreasury.deploy(
    roseTokenAddress,
    addresses.usdc,
    addresses.wbtc,
    addresses.reth,
    addresses.paxg,
    addresses.btcUsdFeed,
    addresses.ethUsdFeed,
    addresses.xauUsdFeed,
    addresses.swapRouter
  );
  await roseTreasury.waitForDeployment();
  const treasuryAddress = await roseTreasury.getAddress();
  console.log("RoseTreasury deployed to:", treasuryAddress);

  // ============ Step 3: Deploy RoseMarketplace ============
  console.log("\n--- Step 3: Deploying RoseMarketplace ---");
  const RoseMarketplace = await hre.ethers.getContractFactory("RoseMarketplace");
  // Updated: RoseMarketplace now takes (roseToken, daoTreasury)
  const roseMarketplace = await RoseMarketplace.deploy(roseTokenAddress, treasuryAddress);
  await roseMarketplace.waitForDeployment();
  const marketplaceAddress = await roseMarketplace.getAddress();
  console.log("RoseMarketplace deployed to:", marketplaceAddress);

  // ============ Step 4: Wire up authorizations ============
  console.log("\n--- Step 4: Setting up authorizations ---");

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

  // Set marketplace in treasury (for task posting)
  console.log("Setting marketplace in Treasury...");
  const setMarketplaceTx = await roseTreasury.setMarketplace(marketplaceAddress);
  await setMarketplaceTx.wait();
  console.log("Marketplace set in Treasury ✓");

  // For testnet, set allocation to diversified RWA using mock router
  if (isTestnet) {
    console.log("Setting testnet allocation (40% BTC, 40% Gold, 20% USDC)...");
    const setAllocTx = await roseTreasury.setAllocation(4000, 0, 4000, 2000); // 40% BTC, 0% ETH, 40% Gold, 20% USDC
    await setAllocTx.wait();
    console.log("Testnet allocation set to 40% BTC, 40% Gold, 20% USDC ✓");

    // Increase slippage tolerance to 2% for testnet (allows exact exchange rates)
    console.log("Setting testnet slippage tolerance (5%)...");
    const setSlippageTx = await roseTreasury.setMaxSlippage(500); // 5% = 500 bps
    await setSlippageTx.wait();
    console.log("Slippage tolerance set ✓");
  }

  // ============ Summary ============
  console.log("\n========================================");
  console.log("        DEPLOYMENT COMPLETE");
  console.log("========================================");
  console.log("RoseToken:       ", roseTokenAddress);
  console.log("RoseTreasury:    ", treasuryAddress);
  console.log("RoseMarketplace: ", marketplaceAddress);
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
      roseTreasury: treasuryAddress,
      roseMarketplace: marketplaceAddress,
    },
    // Legacy field names for backward compatibility with frontend
    tokenAddress: roseTokenAddress,
    treasuryAddress: treasuryAddress,
    marketplaceAddress: marketplaceAddress,
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

1. Get USDC (or testnet USDC on Sepolia)

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
