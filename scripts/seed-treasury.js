const hre = require("hardhat");
const fs = require("fs");

/**
 * Seed the RoseTreasury with initial capital
 * 
 * Run after deploy.js:
 * npx hardhat run scripts/seed-treasury.js --network sepolia
 */

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

  const treasuryAddress = deployment.contracts.roseTreasury;
  const usdcAddress = deployment.externalAddresses.usdc;

  console.log("Treasury address:", treasuryAddress);
  console.log("USDC address:", usdcAddress);

  // Get contract instances
  const treasury = await hre.ethers.getContractAt("RoseTreasury", treasuryAddress);
  const usdc = await hre.ethers.getContractAt("IERC20", usdcAddress);

  // Check current balances
  const usdcBalance = await usdc.balanceOf(deployer.address);
  console.log("\nYour USDC balance:", hre.ethers.formatUnits(usdcBalance, 6), "USDC");

  // ============ OPTION 1: Deposit (mints ROSE to you) ============
  // Use this if you want to receive ROSE tokens for your deposit
  
  const depositAmount = hre.ethers.parseUnits("1", 6); // 1 USDC
  
  if (usdcBalance >= depositAmount) {
    console.log("\n--- Depositing", hre.ethers.formatUnits(depositAmount, 6), "USDC ---");
    
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

    // Check results
    const priceAfter = await treasury.rosePrice();
    console.log("ROSE price after:", hre.ethers.formatUnits(priceAfter, 6), "USD");

    const breakdown = await treasury.getVaultBreakdown();
    console.log("\n--- Vault Breakdown ---");
    console.log("BTC value:  $", hre.ethers.formatUnits(breakdown.btcValue, 6));
    console.log("ETH value:  $", hre.ethers.formatUnits(breakdown.ethValue, 6));
    console.log("Gold value: $", hre.ethers.formatUnits(breakdown.goldValue, 6));
    console.log("USDC value: $", hre.ethers.formatUnits(breakdown.usdcValue, 6));
    console.log("Total:      $", hre.ethers.formatUnits(breakdown.totalValue, 6));
    console.log("Treasury ROSE:", hre.ethers.formatEther(breakdown.treasuryRose));
    console.log("ROSE price: $", hre.ethers.formatUnits(breakdown.currentRosePrice, 6));

  } else {
    console.log("\nInsufficient USDC balance for deposit.");
    console.log("Need:", hre.ethers.formatUnits(depositAmount, 6), "USDC");
    console.log("Have:", hre.ethers.formatUnits(usdcBalance, 6), "USDC");
    
    console.log("\n--- How to get testnet USDC ---");
    console.log("Sepolia USDC faucet: https://faucet.circle.com/");
    console.log("Or use a mock USDC contract for testing.");
  }

  // ============ OPTION 2: Direct Transfer (no ROSE minted) ============
  // Use this for protocol seeding where assets should stay in treasury
  // without minting ROSE to anyone
  /*
  console.log("\n--- Direct USDC Transfer (no ROSE minted) ---");
  const transferTx = await usdc.transfer(treasuryAddress, depositAmount);
  await transferTx.wait();
  console.log("Transferred directly to treasury ✓");
  */
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });