const hre = require("hardhat");
const fs = require("fs");

// ============ Mainnet Addresses (Arbitrum One) ============
// Note: Using lowercase addresses - ethers.js v6 is strict about EIP-55 checksums
const ARBITRUM_MAINNET = {
  usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",      // Native USDC on Arbitrum
  tbtc: "0x6c84a8f1c29108f47a79964b5fe888d4f4d0de40",      // tBTC on Arbitrum
  xaut: "0x40461291347e1ecbb09499f3371d3f17f10d7159",      // Tether Gold (XAUt) on Arbitrum
  btcUsdFeed: "0x6ce185860a4963106506c203335a2910413708e9", // Chainlink BTC/USD Arbitrum
  xauUsdFeed: "0x1f954dc24a49708c26e0c1777f16750b5c6d5a2c", // Chainlink XAU/USD Arbitrum
  lifiDiamond: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", // LiFi Diamond Arbitrum
};

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

  // Verify we're on Arbitrum One mainnet
  if (chainId !== 42161) {
    throw new Error(`Expected Arbitrum One (chainId 42161), got chainId ${chainId}. Use deploy.js for testnet.`);
  }

  console.log("Using ARBITRUM_MAINNET addresses (Arbitrum One)");
  const addresses = { ...ARBITRUM_MAINNET };

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

  // Get passport signer address from env (REQUIRED for mainnet)
  const passportSignerAddress = process.env.PASSPORT_SIGNER_ADDRESS;
  if (!passportSignerAddress) {
    throw new Error("PASSPORT_SIGNER_ADDRESS is required for mainnet deployment");
  }
  console.log("Passport signer:", passportSignerAddress);

  // ============ Step 2: Deploy RoseTreasury ============
  console.log("\n--- Step 2: Deploying RoseTreasury ---");
  const RoseTreasury = await hre.ethers.getContractFactory("RoseTreasury");
  // Constructor: (roseToken, usdc, lifiDiamond, passportSigner) - assets added via addAsset()
  const roseTreasury = await RoseTreasury.deploy(
    roseTokenAddress,
    addresses.usdc,
    addresses.lifiDiamond,
    passportSignerAddress
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
    18,   // decimals - tBTC on Arbitrum has 18 decimals
    3000  // 30%
  )).wait();
  console.log("  BTC asset registered (30%)");

  // GOLD: 30% (using XAUt - Tether Gold)
  const goldKey = hre.ethers.encodeBytes32String("GOLD");
  await (await roseTreasury.addAsset(
    goldKey,
    addresses.xaut,
    addresses.xauUsdFeed,
    6,    // XAUt has 6 decimals
    3000  // 30%
  )).wait();
  console.log("  GOLD asset registered (30%)");

  // STABLE (USDC): 20%
  const stableKey = hre.ethers.encodeBytes32String("STABLE");
  await (await roseTreasury.addAsset(
    stableKey,
    addresses.usdc,
    hre.ethers.ZeroAddress, // No price feed for stablecoin
    6,    // decimals
    2000  // 20%
  )).wait();
  console.log("  STABLE asset registered (20%)");

  // ROSE: 20%
  const roseKey = hre.ethers.encodeBytes32String("ROSE");
  await (await roseTreasury.addAsset(
    roseKey,
    roseTokenAddress,
    hre.ethers.ZeroAddress, // Uses NAV, not price feed
    18,   // decimals
    2000  // 20%
  )).wait();
  console.log("  ROSE asset registered (20%)");

  // Validate allocations sum to 100%
  const validAllocations = await roseTreasury.validateAllocations();
  console.log("  Allocations valid:", validAllocations ? "YES" : "NO");

  // ============ Step 3: Deploy RoseMarketplace ============
  console.log("\n--- Step 3: Deploying RoseMarketplace ---");
  const RoseMarketplace = await hre.ethers.getContractFactory("RoseMarketplace");
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
    reputationAddress
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
  console.log("Treasury authorized");

  // Authorize Marketplace to mint/burn ROSE
  console.log("Authorizing Marketplace for mint/burn...");
  const authMarketplaceTx = await roseToken.setAuthorized(marketplaceAddress, true);
  await authMarketplaceTx.wait();
  console.log("Marketplace authorized");

  // Authorize Governance to mint/burn ROSE
  console.log("Authorizing Governance for mint/burn...");
  const authGovernanceTx = await roseToken.setAuthorized(governanceAddress, true);
  await authGovernanceTx.wait();
  console.log("Governance authorized");

  // Set marketplace in treasury (for task posting)
  console.log("Setting marketplace in Treasury...");
  const setMarketplaceTx = await roseTreasury.setMarketplace(marketplaceAddress);
  await setMarketplaceTx.wait();
  console.log("Marketplace set in Treasury");

  // Set vROSE governance and marketplace
  console.log("Setting vROSE governance...");
  await (await vRose.setGovernance(governanceAddress)).wait();
  console.log("vROSE governance set");

  console.log("Setting vROSE marketplace...");
  await (await vRose.setMarketplace(marketplaceAddress)).wait();
  console.log("vROSE marketplace set");

  // Set marketplace vROSE and governance references
  console.log("Setting marketplace vROSE token...");
  await (await roseMarketplace.setVRoseToken(vRoseAddress)).wait();
  console.log("Marketplace vROSE set");

  console.log("Setting marketplace governance...");
  await (await roseMarketplace.setGovernance(governanceAddress)).wait();
  console.log("Marketplace governance set");

  // Set reputation's governance to real governance address (was deployer at deploy time)
  console.log("Setting reputation governance...");
  await (await roseReputation.setGovernance(governanceAddress)).wait();
  console.log("Reputation governance set");

  // Set reputation contract in marketplace
  console.log("Setting marketplace reputation...");
  await (await roseMarketplace.setReputation(reputationAddress)).wait();
  console.log("Marketplace reputation set");

  // Set delegation signer for delegated voting (required for castDelegatedVote)
  console.log("Setting delegation signer...");
  await (await roseGovernance.setDelegationSigner(passportSignerAddress)).wait();
  console.log("Delegation signer set to:", passportSignerAddress);

  // Set rebalancer for treasury swaps (uses same signer wallet)
  console.log("Setting treasury rebalancer...");
  await (await roseTreasury.setRebalancer(passportSignerAddress)).wait();
  console.log("Treasury rebalancer set to:", passportSignerAddress);

  // ============ Summary ============
  console.log("\n========================================");
  console.log("    MAINNET DEPLOYMENT COMPLETE");
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
    network: "arbitrum",
    chainId: chainId,
    isTestnet: false,
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
  console.log("     POST-DEPLOYMENT: NEXT STEPS");
  console.log("========================================");
  console.log(`
IMPORTANT: This is a mainnet deployment. No automatic seeding was performed.

To seed the treasury with initial capital:

1. Acquire USDC on Arbitrum One

2. Approve treasury to spend your USDC:
   await usdc.approve("${treasuryAddress}", amount);

3. Deposit to get ROSE (auto-diversifies into RWA):
   await treasury.deposit(amount, expiry, signature);
   (Requires passport signature from backend)

4. Verify vault status:
   await treasury.getVaultBreakdown();
   await treasury.rosePrice();

Contract Verification:
   npx hardhat verify --network arbitrum ${roseTokenAddress} ${deployer.address}
   npx hardhat verify --network arbitrum ${vRoseAddress}
   npx hardhat verify --network arbitrum ${treasuryAddress} ${roseTokenAddress} ${addresses.usdc} ${addresses.lifiDiamond} ${passportSignerAddress}
   npx hardhat verify --network arbitrum ${marketplaceAddress} ${roseTokenAddress} ${treasuryAddress} ${passportSignerAddress}
   npx hardhat verify --network arbitrum ${reputationAddress} ${deployer.address} ${marketplaceAddress} ${passportSignerAddress}
   npx hardhat verify --network arbitrum ${governanceAddress} ${roseTokenAddress} ${vRoseAddress} ${marketplaceAddress} ${treasuryAddress} ${passportSignerAddress} ${reputationAddress}
`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
