const hre = require("hardhat");
const fs = require("fs");

/**
 * Reputation Seeding Script
 *
 * Creates and completes 10 tasks to give the deployer address 90%+ reputation,
 * enabling governance features (propose, vote, delegate).
 *
 * Role assignment:
 * - Worker = Deployer (receives reputation)
 * - Customer = Throwaway wallet
 * - Stakeholder = Throwaway wallet
 */

async function main() {
  console.log("\n========================================");
  console.log("    REPUTATION SEEDING SCRIPT");
  console.log("========================================\n");

  // 1. Load deployment addresses
  if (!fs.existsSync("deployment-output.json")) {
    console.error("deployment-output.json not found. Run deploy.js first.");
    process.exit(1);
  }
  const deployment = JSON.parse(fs.readFileSync("deployment-output.json"));
  console.log("Loaded deployment addresses from deployment-output.json");

  // 2. Get deployer (will be the worker)
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer (worker):", deployer.address);

  // 3. Create throwaway wallets for customer & stakeholder
  // Use STAKEHOLDER_PRIVATE_KEY from env if provided, otherwise create throwaway
  const customer = process.env.CUSTOMER_PRIVATE_KEY
    ? new hre.ethers.Wallet(process.env.CUSTOMER_PRIVATE_KEY, hre.ethers.provider)
    : hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  const stakeholder = process.env.STAKEHOLDER_PRIVATE_KEY
    ? new hre.ethers.Wallet(process.env.STAKEHOLDER_PRIVATE_KEY, hre.ethers.provider)
    : hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  console.log("Customer (temp):", customer.address);
  console.log(`Stakeholder (${process.env.STAKEHOLDER_PRIVATE_KEY ? 'from env' : 'temp'}):`, stakeholder.address);

  // 4. Get contract instances
  const roseToken = await hre.ethers.getContractAt("RoseToken", deployment.tokenAddress);
  const marketplace = await hre.ethers.getContractAt("RoseMarketplace", deployment.marketplaceAddress);
  const governance = await hre.ethers.getContractAt("RoseGovernance", deployment.governanceAddress);
  const vRoseToken = await hre.ethers.getContractAt("vROSE", deployment.vRoseAddress);

  // 5. Calculate funding amounts
  const NUM_TASKS = 10;
  const TASK_VALUE = hre.ethers.parseUnits("100", 18); // 100 ROSE per task
  const STAKE_VALUE = TASK_VALUE / 10n; // 10 ROSE (10% of task value)
  const GAS_ETH = hre.ethers.parseEther("0.005"); // ETH for gas

  const customerRoseNeeded = TASK_VALUE * BigInt(NUM_TASKS + 1); // 1100 ROSE (buffer)
  const stakeholderRoseNeeded = STAKE_VALUE * BigInt(NUM_TASKS + 1); // 110 ROSE (buffer)

  console.log("\n--- Funding Throwaway Wallets ---");

  // 6. Fund wallets with ETH for gas
  console.log("Sending ETH for gas...");
  await (await deployer.sendTransaction({ to: customer.address, value: GAS_ETH })).wait();
  await (await deployer.sendTransaction({ to: stakeholder.address, value: GAS_ETH })).wait();
  console.log(`  Customer: ${hre.ethers.formatEther(GAS_ETH)} ETH ✓`);
  console.log(`  Stakeholder: ${hre.ethers.formatEther(GAS_ETH)} ETH ✓`);

  // 7. Fund wallets with ROSE
  console.log("Sending ROSE tokens...");
  await (await roseToken.transfer(customer.address, customerRoseNeeded)).wait();
  await (await roseToken.transfer(stakeholder.address, stakeholderRoseNeeded)).wait();
  console.log(`  Customer: ${hre.ethers.formatUnits(customerRoseNeeded, 18)} ROSE ✓`);
  console.log(`  Stakeholder: ${hre.ethers.formatUnits(stakeholderRoseNeeded, 18)} ROSE ✓`);

  // 8. Helper functions for signatures (deployer is passport signer on testnet)
  async function signPassport(address, action, expiry) {
    const messageHash = hre.ethers.solidityPackedKeccak256(
      ["address", "string", "uint256"],
      [address, action, expiry]
    );
    return deployer.signMessage(hre.ethers.getBytes(messageHash));
  }

  async function signReputation(address, reputation, expiry) {
    const messageHash = hre.ethers.solidityPackedKeccak256(
      ["string", "address", "uint256", "uint256"],
      ["reputation", address, reputation, expiry]
    );
    return deployer.signMessage(hre.ethers.getBytes(messageHash));
  }

  // 9. Stakeholder: Deposit ROSE to governance to get vROSE
  console.log("\n--- Stakeholder: Getting vROSE ---");
  const DEFAULT_REPUTATION = 60; // Cold start reputation for new users
  const repExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  const repSig = await signReputation(stakeholder.address, DEFAULT_REPUTATION, repExpiry);
  await (await roseToken.connect(stakeholder).approve(governance.target, stakeholderRoseNeeded)).wait();
  await (await governance.connect(stakeholder).deposit(
    stakeholderRoseNeeded,
    DEFAULT_REPUTATION,
    repExpiry,
    repSig
  )).wait();
  const vRoseBalance = await vRoseToken.balanceOf(stakeholder.address);
  console.log(`  Deposited ROSE, received ${hre.ethers.formatUnits(vRoseBalance, 18)} vROSE ✓`);

  // 10. Pre-approve marketplace for customer and stakeholder
  console.log("\n--- Setting Up Approvals ---");
  await (await roseToken.connect(customer).approve(marketplace.target, customerRoseNeeded)).wait();
  console.log("  Customer approved marketplace for ROSE ✓");
  await (await vRoseToken.connect(stakeholder).approve(marketplace.target, stakeholderRoseNeeded)).wait();
  console.log("  Stakeholder approved marketplace for vROSE ✓");

  // 11. Complete 10 tasks
  console.log("\n--- Completing Tasks ---");

  for (let i = 0; i < NUM_TASKS; i++) {
    const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    // a. Customer creates task
    const createSig = await signPassport(customer.address, "createTask", expiry);
    const createTx = await marketplace.connect(customer).createTask(
      `Seed Task ${i + 1}`,
      TASK_VALUE,
      "ipfs://QmSeedTaskDescription",
      expiry,
      createSig
    );
    const createReceipt = await createTx.wait();

    // Extract taskId from TaskCreated event
    const taskCreatedEvent = createReceipt.logs.find(
      log => log.fragment?.name === "TaskCreated"
    );
    const taskId = taskCreatedEvent?.args?.[0] || BigInt(i + 1);

    // b. Stakeholder stakes (10% in vROSE)
    const stakeSig = await signPassport(stakeholder.address, "stake", expiry);
    await (await marketplace.connect(stakeholder).stakeholderStake(
      taskId,
      STAKE_VALUE,
      expiry,
      stakeSig
    )).wait();

    // c. Deployer (worker) claims task
    const claimSig = await signPassport(deployer.address, "claim", expiry);
    await (await marketplace.claimTask(taskId, expiry, claimSig)).wait();

    // d. Worker marks task completed
    await (await marketplace.markTaskCompleted(taskId, "https://github.com/seed/pr")).wait();

    // e. Customer approves
    await (await marketplace.connect(customer).approveCompletionByCustomer(taskId)).wait();

    // f. Stakeholder approves
    await (await marketplace.connect(stakeholder).approveCompletionByStakeholder(taskId)).wait();

    // g. Worker accepts payment
    await (await marketplace.acceptPayment(taskId)).wait();

    console.log(`  Task ${i + 1}/${NUM_TASKS} completed ✓`);
  }

  // 12. Verify final reputation
  console.log("\n--- Verifying Reputation ---");
  const reputation = await governance.getReputation(deployer.address);
  const canPropose = await governance.canPropose(deployer.address);
  const canVote = await governance.canVote(deployer.address);
  const canDelegate = await governance.canDelegate(deployer.address);
  const userStats = await governance.userStats(deployer.address);

  console.log(`  Deployer address: ${deployer.address}`);
  console.log(`  Reputation: ${reputation}%`);
  console.log(`  Tasks completed: ${userStats[0]}`);
  console.log(`  Can propose: ${canPropose}`);
  console.log(`  Can vote: ${canVote}`);
  console.log(`  Can delegate: ${canDelegate}`);

  console.log("\n========================================");
  console.log("    REPUTATION SEEDING COMPLETE");
  console.log("========================================\n");

  if (canPropose) {
    console.log("✓ Deployer now has full governance access!");
  } else {
    console.log("⚠ Reputation may need more tasks or time to meet thresholds");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
