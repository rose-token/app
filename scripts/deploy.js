const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const daoTreasury = process.env.DAO_TREASURY_ADDRESS || deployer.address;
  console.log("DAO Treasury address:", daoTreasury);

  const RoseMarketplace = await hre.ethers.getContractFactory("RoseMarketplace");
  const roseMarketplace = await RoseMarketplace.deploy(daoTreasury);
  await roseMarketplace.waitForDeployment();

  const marketplaceAddress = await roseMarketplace.getAddress();
  console.log("RoseMarketplace deployed to:", marketplaceAddress);

  const roseTokenAddress = await roseMarketplace.roseToken();
  console.log("RoseToken deployed to:", roseTokenAddress);
  
  const roseReputationAddress = await roseMarketplace.roseReputation();
  console.log("RoseReputation deployed to:", roseReputationAddress);

  const StakeholderRegistry = await hre.ethers.getContractFactory("StakeholderRegistry");
  const stakeholderRegistry = await StakeholderRegistry.deploy(roseTokenAddress, roseReputationAddress);
  await stakeholderRegistry.waitForDeployment();
  
  const stakeholderRegistryAddress = await stakeholderRegistry.getAddress();
  console.log("StakeholderRegistry deployed to:", stakeholderRegistryAddress);
  
  await roseMarketplace.setStakeholderRegistry(stakeholderRegistryAddress);
  console.log("StakeholderRegistry set in marketplace");
  
  
  const minimumTokensToPropose = hre.ethers.parseEther("10"); // 10 ROSE tokens
  const RoseGovernance = await hre.ethers.getContractFactory("RoseGovernance");
  const roseGovernance = await RoseGovernance.deploy(
    roseTokenAddress,
    roseReputationAddress,
    marketplaceAddress,
    minimumTokensToPropose
  );
  await roseGovernance.waitForDeployment();
  
  const governanceAddress = await roseGovernance.getAddress();
  console.log("RoseGovernance deployed to:", governanceAddress);
  
  await roseMarketplace.setGovernanceContract(governanceAddress);
  console.log("Governance contract set in marketplace");
  
  await stakeholderRegistry.authorizeContract(marketplaceAddress);
  console.log("Marketplace authorized to use stakeholder registry");

  const TokenStaking = await hre.ethers.getContractFactory("TokenStaking");
  const tokenStaking = await TokenStaking.deploy(roseTokenAddress, stakeholderRegistryAddress, daoTreasury);
  await tokenStaking.waitForDeployment();
  
  const tokenStakingAddress = await tokenStaking.getAddress();
  console.log("TokenStaking deployed to:", tokenStakingAddress);
  
  await roseGovernance.setMarketplaceTokenStaking(tokenStakingAddress);
  console.log("TokenStaking set in marketplace via governance");

  const BidEvaluationManager = await hre.ethers.getContractFactory("BidEvaluationManager");
  const bidEvaluationManager = await BidEvaluationManager.deploy(tokenStakingAddress, marketplaceAddress);
  await bidEvaluationManager.waitForDeployment();
  
  const bidEvaluationManagerAddress = await bidEvaluationManager.getAddress();
  console.log("BidEvaluationManager deployed to:", bidEvaluationManagerAddress);
  
  await roseMarketplace.setBidEvaluationManager(bidEvaluationManagerAddress);
  console.log("BidEvaluationManager set in marketplace");

  console.log("\nContract Details:");
  console.log("----------------");
  console.log("RoseMarketplace:", marketplaceAddress);
  console.log("RoseToken:", roseTokenAddress);
  console.log("RoseReputation:", roseReputationAddress);
  console.log("RoseGovernance:", governanceAddress);
  console.log("StakeholderRegistry:", stakeholderRegistryAddress);
  console.log("TokenStaking:", tokenStakingAddress);
  console.log("BidEvaluationManager:", bidEvaluationManagerAddress);
  console.log("DAO Treasury:", daoTreasury);
  
  const deploymentOutput = {
    marketplaceAddress: marketplaceAddress,
    tokenAddress: roseTokenAddress,
    reputationAddress: roseReputationAddress,
    governanceAddress: governanceAddress,
    stakeholderRegistryAddress: stakeholderRegistryAddress,
    tokenStakingAddress: tokenStakingAddress,
    bidEvaluationManagerAddress: bidEvaluationManagerAddress,
    daoTreasuryAddress: daoTreasury
  };
  
  fs.writeFileSync(
    "deployment-output.json",
    JSON.stringify(deploymentOutput, null, 2)
  );
  
  console.log("Deployment information saved to deployment-output.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
