const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Display deployer's ETH balance
  const initialBalance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer's Sepolia ETH balance:", hre.ethers.formatEther(initialBalance), "ETH");

  const daoTreasury = process.env.DAO_TREASURY_ADDRESS || deployer.address;
  console.log("DAO Treasury address:", daoTreasury);

  const RoseMarketplace = await hre.ethers.getContractFactory("RoseMarketplace");
  const roseMarketplace = await RoseMarketplace.deploy(daoTreasury);
  await roseMarketplace.waitForDeployment();

  const marketplaceAddress = await roseMarketplace.getAddress();
  console.log("RoseMarketplace deployed to:", marketplaceAddress);

  const roseTokenAddress = await roseMarketplace.roseToken();
  console.log("RoseToken deployed to:", roseTokenAddress);

  const StakeholderRegistry = await hre.ethers.getContractFactory("StakeholderRegistry");
  const stakeholderRegistry = await StakeholderRegistry.deploy(roseTokenAddress);
  await stakeholderRegistry.waitForDeployment();
  
  const stakeholderRegistryAddress = await stakeholderRegistry.getAddress();
  console.log("StakeholderRegistry deployed to:", stakeholderRegistryAddress);
  
  await roseMarketplace.setStakeholderRegistry(stakeholderRegistryAddress);
  console.log("StakeholderRegistry set in marketplace");

  await stakeholderRegistry.authorizeContract(marketplaceAddress);
  console.log("Marketplace authorized to use stakeholder registry");

  const TokenStaking = await hre.ethers.getContractFactory("TokenStaking");
  const tokenStaking = await TokenStaking.deploy(roseTokenAddress, stakeholderRegistryAddress, daoTreasury);
  await tokenStaking.waitForDeployment();
  
  const tokenStakingAddress = await tokenStaking.getAddress();
  console.log("TokenStaking deployed to:", tokenStakingAddress);

  console.log("\nContract Details:");
  console.log("----------------");
  console.log("RoseMarketplace:", marketplaceAddress);
  console.log("RoseToken:", roseTokenAddress);
  console.log("StakeholderRegistry:", stakeholderRegistryAddress);
  console.log("TokenStaking:", tokenStakingAddress);
  console.log("DAO Treasury:", daoTreasury);

  const deploymentOutput = {
    marketplaceAddress: marketplaceAddress,
    tokenAddress: roseTokenAddress,
    stakeholderRegistryAddress: stakeholderRegistryAddress,
    tokenStakingAddress: tokenStakingAddress,
    daoTreasuryAddress: daoTreasury
  };
  
  fs.writeFileSync(
    "deployment-output.json",
    JSON.stringify(deploymentOutput, null, 2)
  );
  
  console.log("Deployment information saved to deployment-output.json");
  
  // Display final balance and gas consumed
  const finalBalance = await hre.ethers.provider.getBalance(deployer.address);
  const gasUsed = initialBalance - finalBalance;
  console.log("\n=== Deployment Cost Summary ===");
  console.log("Final Sepolia ETH balance:", hre.ethers.formatEther(finalBalance), "ETH");
  console.log("Total ETH used for deployment:", hre.ethers.formatEther(gasUsed), "ETH");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
