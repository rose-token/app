const { ethers } = require("hardhat");

/**
 * Deploy RoseBaseGateway to Base.
 *
 * Required env vars:
 *   DEPLOYER_PRIVATE_KEY   — deployer / owner private key
 *   ARBITRUM_RECIPIENT     — (optional) bytes32-encoded Arb-side recipient.
 *                            Defaults to deployer address padded to bytes32.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-base-gateway.js --network base
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying RoseBaseGateway with account:", deployer.address);
  console.log(
    "Account balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH"
  );

  // ── Addresses ──────────────────────────────────
  const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const BASE_TOKEN_MESSENGER = "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962";

  // Arbitrum recipient — default to deployer (the signer) padded to bytes32
  const arbRecipientEnv = process.env.ARBITRUM_RECIPIENT;
  const arbitrumRecipient = arbRecipientEnv
    ? arbRecipientEnv
    : ethers.zeroPadValue(deployer.address, 32);

  console.log("\nParameters:");
  console.log("  USDC:             ", BASE_USDC);
  console.log("  TokenMessenger:   ", BASE_TOKEN_MESSENGER);
  console.log("  Arb Recipient:    ", arbitrumRecipient);
  console.log("  Owner:            ", deployer.address);

  // ── Deploy ─────────────────────────────────────
  const Gateway = await ethers.getContractFactory("RoseBaseGateway");
  const gateway = await Gateway.deploy(
    BASE_USDC,
    BASE_TOKEN_MESSENGER,
    arbitrumRecipient,
    deployer.address
  );
  await gateway.waitForDeployment();

  const address = await gateway.getAddress();
  console.log("\n✅ RoseBaseGateway deployed to:", address);

  // ── Verify ─────────────────────────────────────
  console.log("\nTo verify on BaseScan:");
  console.log(
    `  npx hardhat verify --network base ${address} ` +
      `${BASE_USDC} ${BASE_TOKEN_MESSENGER} ${arbitrumRecipient} ${deployer.address}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
