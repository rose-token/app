const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const daoTreasury = deployer.address;
  console.log("DAO Treasury address:", daoTreasury);

  const RoseMarketplace = await hre.ethers.getContractFactory("RoseMarketplace");
  const roseMarketplace = await RoseMarketplace.deploy(daoTreasury);
  await roseMarketplace.waitForDeployment();

  const marketplaceAddress = await roseMarketplace.getAddress();
  console.log("RoseMarketplace deployed to:", marketplaceAddress);

  const roseTokenAddress = await roseMarketplace.roseToken();
  console.log("RoseToken deployed to:", roseTokenAddress);

  console.log("\nContract Details:");
  console.log("----------------");
  console.log("RoseMarketplace:", marketplaceAddress);
  console.log("RoseToken:", roseTokenAddress);
  console.log("DAO Treasury:", daoTreasury);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
