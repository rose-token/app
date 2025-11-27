const hre = require("hardhat");
const fs = require("fs");

/**
 * Seed the RoseTreasury with initial capital
 * 
 * For testnet: Uses mock USDC and auto-mints
 * For mainnet: Requires real USDC in deployer wallet
 * 
 * Run after deploy.js:
 * npx hardhat run scripts/seed-treasury.js --network opsepolia
 */

// Amount to seed (in USDC, 6 decimals)
const SEED_AMOUNT = process.env.SEED_AMOUNT || "10000"; // Default 10k USDC

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Seeding treasury with account:", deployer.address);

  // Load deployment info
  let deployment;
  try {
    deployment = JSON.parse(fs.readFileSync("deployment-output.json", "utf8"));
  } catch (e) {
    console.error("Error: Run deploy.js first to create deployment-output.json");
    process.exit(1);
  }

  const treasuryAddress = deployment.contracts.roseTreasury || deployment.treasuryAddress;
  const roseTokenAddress = deployment.contracts.roseToken || deployment.tokenAddress;
  const usdcAddress = deployment.externalAddresses.usdc;
  const isTestnet = deployment.isTestnet;

  console.log("Treasury address:", treasuryAddress);
  console.log("RoseToken address:", roseTokenAddress);
  console.log("USDC address:", usdcAddress);
  console.log("Is Testnet:", isTestnet);

  // Get contract instances
  const treasury = await hre.ethers.getContractAt("RoseTreasury", treasuryAddress);
  const roseToken = await hre.ethers.getContractAt("RoseToken", roseTokenAddress);
  
  // For testnet, we might need to use our own mock USDC if Circle's doesn't work
  // Check if it's Circle's USDC or our mock
  let usdc;
  try {
    // Try to get MockERC20 interface (has mint function)
    usdc = await hre.ethers.getContractAt("MockERC20", usdcAddress);
    // Try a test call to see if mint exists
    await usdc.mint.staticCall(deployer.address, 0);
    console.log("Using MockERC20 (can mint)");
  } catch {
    // Fall back to standard IERC20 (Circle's USDC)
    usdc = await hre.ethers.getContractAt("IERC20", usdcAddress);
    console.log("Using standard IERC20 (Circle USDC - get from faucet)");
  }

  const depositAmount = hre.ethers.parseUnits(SEED_AMOUNT, 6);
  console.log("\nSeed amount:", SEED_AMOUNT, "USDC");

  // Check current balances
  let usdcBalance = await usdc.balanceOf(deployer.address);
  console.log("Current USDC balance:", hre.ethers.formatUnits(usdcBalance, 6), "USDC");

  // On testnet, try to mint USDC if we have a mock
  if (isTestnet && usdcBalance < depositAmount) {
    console.log("\n--- Attempting to mint testnet USDC ---");
    try {
      // This will only work if usdc is a MockERC20
      const mintTx = await usdc.mint(deployer.address, depositAmount);
      await mintTx.wait();
      console.log("Minted", SEED_AMOUNT, "testnet USDC ✓");
      usdcBalance = await usdc.balanceOf(deployer.address);
    } catch (e) {
      console.log("Cannot mint USDC (using Circle USDC).");
      console.log("Get testnet USDC from: https://faucet.circle.com/");
      console.log("Error:", e.message?.substring(0, 100));
    }
  }

  if (usdcBalance < depositAmount) {
    console.error("\nInsufficient USDC balance for deposit.");
    console.error("Need:", hre.ethers.formatUnits(depositAmount, 6), "USDC");
    console.error("Have:", hre.ethers.formatUnits(usdcBalance, 6), "USDC");
    
    if (!isTestnet) {
      console.log("\n--- For mainnet, you need real USDC ---");
    } else {
      console.log("\n--- For testnet USDC, use mock tokens or get from a faucet ---");
    }
    process.exit(1);
  }

  // ============ Deposit to Treasury ============
  console.log("\n--- Depositing", SEED_AMOUNT, "USDC to Treasury ---");
  
  // Approve treasury to spend USDC
  console.log("Approving USDC spend...");
  const approveTx = await usdc.approve(treasuryAddress, depositAmount);
  await approveTx.wait();
  console.log("Approved ✓");

  // Check ROSE price before deposit
  const priceBefore = await treasury.rosePrice();
  console.log("ROSE price before:", hre.ethers.formatUnits(priceBefore, 6), "USD");

  // Deposit
  console.log("Depositing...");
  const depositTx = await treasury.deposit(depositAmount);
  await depositTx.wait();
  console.log("Deposited ✓");

  // ============ Check Results ============
  const priceAfter = await treasury.rosePrice();
  console.log("ROSE price after:", hre.ethers.formatUnits(priceAfter, 6), "USD");

  const breakdown = await treasury.getVaultBreakdown();
  console.log("\n========================================");
  console.log("        TREASURY SEEDED");
  console.log("========================================");
  console.log("BTC value:       $", hre.ethers.formatUnits(breakdown.btcValue, 6));
  console.log("Gold value:      $", hre.ethers.formatUnits(breakdown.goldValue, 6));
  console.log("USDC value:      $", hre.ethers.formatUnits(breakdown.usdcValue, 6));
  console.log("----------------------------------------");
  console.log("Total vault:     $", hre.ethers.formatUnits(breakdown.totalHardAssets, 6));
  console.log("Circulating ROSE:", hre.ethers.formatEther(breakdown.circulatingRose));
  console.log("ROSE price:      $", hre.ethers.formatUnits(breakdown.currentRosePrice, 6));
  console.log("========================================");

  // Check deployer's ROSE balance (they got ROSE for their deposit)
  const deployerRose = await roseToken.balanceOf(deployer.address);
  console.log("\nDeployer ROSE balance:", hre.ethers.formatEther(deployerRose), "ROSE");

  // Update deployment output with seed info
  deployment.seeded = true;
  deployment.seedAmount = SEED_AMOUNT;
  deployment.seedTimestamp = new Date().toISOString();
  
  fs.writeFileSync(
    "deployment-output.json",
    JSON.stringify(deployment, null, 2)
  );
  console.log("\nDeployment info updated with seed data ✓");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
