const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RoseMarketplace", function () {
  let roseMarketplace;
  let roseToken;
  let roseTreasury;
  let vRose;
  let governance;
  let usdc;
  let tbtc;
  let reth;
  let paxg;
  let btcFeed;
  let ethFeed;
  let xauFeed;
  let swapRouter;
  let owner;
  let customer;
  let worker;
  let stakeholder;
  let passportSigner;
  let burnAddress;

  // New tokenomics: 95% worker / 5% stakeholder (from customer deposit pot), 2% DAO (minted separately)
  const MINT_PERCENTAGE = 2;
  const WORKER_SHARE = 95;
  const STAKEHOLDER_SHARE = 5;
  const SHARE_DENOMINATOR = 100;

  // Test IPFS hash for detailed descriptions
  const ipfsHash = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

  // Test GitHub PR URL
  const testPrUrl = "https://github.com/test/repo/pull/123";

  // Helper function to get ROSE tokens via Treasury deposit
  async function getRoseTokens(user, usdcAmount) {
    await usdc.mint(user.address, usdcAmount);
    await usdc.connect(user).approve(await roseTreasury.getAddress(), usdcAmount);
    await roseTreasury.connect(user).deposit(usdcAmount);
  }

  // Helper function to generate passport signature
  async function generatePassportSignature(userAddress, action, expiry) {
    // Create message hash matching contract's verification
    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "string", "uint256"],
      [userAddress, action, expiry]
    );
    // Sign the hash (ethers adds the Ethereum signed message prefix)
    const signature = await passportSigner.signMessage(ethers.getBytes(messageHash));
    return signature;
  }

  // Helper to get future expiry timestamp (uses blockchain time, not JS time)
  async function getFutureExpiry() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + 3600; // 1 hour from now
  }

  // Helper function to generate reputation attestation signature
  async function createReputationSignature(signer, user, reputation, expiry) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["string", "address", "uint256", "uint256"],
      ["reputation", user, reputation, expiry]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  // Default reputation for tests (60% cold start)
  const DEFAULT_REPUTATION = 60;

  // Helper to get reputation attestation
  async function getRepAttestation(user, reputation = DEFAULT_REPUTATION) {
    const expiry = await getFutureExpiry();
    const signature = await createReputationSignature(passportSigner, user.address, reputation, expiry);
    return { reputation, expiry, signature };
  }

  beforeEach(async function () {
    [owner, customer, worker, stakeholder, passportSigner] = await ethers.getSigners();
    burnAddress = "0x000000000000000000000000000000000000dEaD";

    // 1. Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    tbtc = await MockERC20.deploy("Wrapped BTC", "TBTC", 8);
    reth = await MockERC20.deploy("Rocket Pool ETH", "rETH", 18);
    paxg = await MockERC20.deploy("Pax Gold", "PAXG", 18);

    // 2. Deploy RoseToken (owner is initial authorized)
    const RoseToken = await ethers.getContractFactory("RoseToken");
    roseToken = await RoseToken.deploy(owner.address);

    // 3. Deploy mock Chainlink price feeds (8 decimals)
    const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
    btcFeed = await MockV3Aggregator.deploy(8, 4300000000000n);  // $43,000
    ethFeed = await MockV3Aggregator.deploy(8, 230000000000n);   // $2,300
    xauFeed = await MockV3Aggregator.deploy(8, 200000000000n);   // $2,000

    // 4. Deploy mock Uniswap router
    const MockUniswapV3Router = await ethers.getContractFactory("MockUniswapV3Router");
    swapRouter = await MockUniswapV3Router.deploy();

    // 5. Set token decimals on router
    await swapRouter.setTokenDecimals(await usdc.getAddress(), 6);
    await swapRouter.setTokenDecimals(await tbtc.getAddress(), 8);
    await swapRouter.setTokenDecimals(await reth.getAddress(), 18);
    await swapRouter.setTokenDecimals(await paxg.getAddress(), 18);

    // 6. Set exchange rates on router (based on mock prices)
    // Formula: amountOut = (amountIn * rate) / 1e18
    // BTC = $43,000: For 1 USDC (1e6), we want 1/43000 BTC (in 8 dec) = 1e8/43000 ≈ 2326
    // rate = 2326 * 1e18 / 1e6 = 2.326e15
    await swapRouter.setExchangeRate(await usdc.getAddress(), await tbtc.getAddress(), 2326n * 10n**12n);
    // ETH = $2,300: For 1 USDC (1e6), we want 1/2300 rETH (in 18 dec) = 1e18/2300 ≈ 4.35e14
    // rate = 4.35e14 * 1e18 / 1e6 = 4.35e26
    await swapRouter.setExchangeRate(await usdc.getAddress(), await reth.getAddress(), 435n * 10n**24n);
    // Gold = $2,000: For 1 USDC (1e6), we want 1/2000 PAXG (in 18 dec) = 1e18/2000 = 5e14
    // rate = 5e14 * 1e18 / 1e6 = 5e26
    await swapRouter.setExchangeRate(await usdc.getAddress(), await paxg.getAddress(), 5n * 10n**26n);

    // 7. Fund router with tokens for swaps (plenty of liquidity)
    await tbtc.mint(await swapRouter.getAddress(), ethers.parseUnits("1000", 8));
    await reth.mint(await swapRouter.getAddress(), ethers.parseUnits("100000", 18));
    await paxg.mint(await swapRouter.getAddress(), ethers.parseUnits("100000", 18));

    // 8. Deploy RoseTreasury
    const RoseTreasury = await ethers.getContractFactory("RoseTreasury");
    roseTreasury = await RoseTreasury.deploy(
      await roseToken.getAddress(),
      await usdc.getAddress(),
      await tbtc.getAddress(),
      await paxg.getAddress(),
      await btcFeed.getAddress(),
      await xauFeed.getAddress(),
      await swapRouter.getAddress()
    );

    // 9. Deploy vROSE soulbound token
    const VROSE = await ethers.getContractFactory("vROSE");
    vRose = await VROSE.deploy();

    // 10. Deploy RoseMarketplace (Treasury is the DAO treasury, passportSigner for verification)
    const RoseMarketplace = await ethers.getContractFactory("RoseMarketplace");
    roseMarketplace = await RoseMarketplace.deploy(
      await roseToken.getAddress(),
      await roseTreasury.getAddress(),
      passportSigner.address
    );

    // 11. Deploy RoseGovernance
    const RoseGovernance = await ethers.getContractFactory("RoseGovernance");
    governance = await RoseGovernance.deploy(
      await roseToken.getAddress(),
      await vRose.getAddress(),
      await roseMarketplace.getAddress(),
      await roseTreasury.getAddress(),
      passportSigner.address
    );

    // 12. Set up vROSE with governance and marketplace
    await vRose.setGovernance(await governance.getAddress());
    await vRose.setMarketplace(await roseMarketplace.getAddress());

    // 13. Set vROSE on marketplace
    await roseMarketplace.setVRoseToken(await vRose.getAddress());

    // 14. Set governance on marketplace
    await roseMarketplace.setGovernance(await governance.getAddress());

    // 15. Authorize Treasury, Marketplace, and Governance on RoseToken
    await roseToken.setAuthorized(await roseTreasury.getAddress(), true);
    await roseToken.setAuthorized(await roseMarketplace.getAddress(), true);
    await roseToken.setAuthorized(await governance.getAddress(), true);

    // 16. Get ROSE tokens via Treasury deposit
    // Deposit enough USDC to get plenty of ROSE for tests
    // Initial price is $1, so 100,000 USDC -> 100,000 ROSE
    const depositAmount = ethers.parseUnits("100000", 6); // 100,000 USDC
    await getRoseTokens(customer, depositAmount);
    await getRoseTokens(stakeholder, depositAmount);

    // 17. Stakeholder needs vROSE for staking - deposit ROSE to governance
    // This gives stakeholder vROSE tokens (1:1 with ROSE deposited)
    const stakeholderVRoseAmount = ethers.parseEther("10000");
    await roseToken.connect(stakeholder).approve(await governance.getAddress(), stakeholderVRoseAmount);
    const repAttest = await getRepAttestation(stakeholder);
    await governance.connect(stakeholder).deposit(stakeholderVRoseAmount, repAttest.reputation, repAttest.expiry, repAttest.signature);
  });

  describe("Deployment", function () {
    it("Should set the correct DAO treasury address", async function () {
      expect(await roseMarketplace.daoTreasury()).to.equal(await roseTreasury.getAddress());
    });

    it("Should have marketplace authorized on RoseToken", async function () {
      expect(await roseToken.authorized(await roseMarketplace.getAddress())).to.equal(true);
    });

    it("Should start with zero task counter", async function () {
      expect(await roseMarketplace.taskCounter()).to.equal(0);
    });
  });

  describe("Task Creation", function () {
    const taskTitle = "Build a website";
    const taskDeposit = ethers.parseEther("1");

    it("Should allow customers to create tasks", async function () {
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(customer.address, "createTask", expiry);

      await expect(
        roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry, signature)
      )
        .to.emit(roseMarketplace, "TaskCreated")
        .withArgs(1, customer.address, taskDeposit);

      expect(await roseMarketplace.taskCounter()).to.equal(1);

      const task = await roseMarketplace.tasks(1);
      expect(task.customer).to.equal(customer.address);
      expect(task.stakeholder).to.equal(ethers.ZeroAddress);
      expect(task.deposit).to.equal(taskDeposit);
      expect(task.title).to.equal(taskTitle);
      expect(task.detailedDescriptionHash).to.equal(ipfsHash);
      expect(task.status).to.equal(1); // TaskStatus.StakeholderRequired
      expect(task.customerApproval).to.equal(false);
      expect(task.stakeholderApproval).to.equal(false);
    });

    it("Should revert if deposit is zero", async function () {
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(customer.address, "createTask", expiry);

      await expect(
        roseMarketplace.connect(customer).createTask(taskTitle, 0, ipfsHash, expiry, signature)
      ).to.be.revertedWith("Token amount must be greater than zero");
    });

    it("Should revert if title is empty", async function () {
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(customer.address, "createTask", expiry);

      await expect(
        roseMarketplace.connect(customer).createTask("", taskDeposit, ipfsHash, expiry, signature)
      ).to.be.revertedWith("Title cannot be empty");
    });

    it("Should revert if detailed description hash is empty", async function () {
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(customer.address, "createTask", expiry);

      await expect(
        roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, "", expiry, signature)
      ).to.be.revertedWith("Detailed description hash is required");
    });

    it("Should revert with expired signature", async function () {
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

      const expiry = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago (expired)
      const signature = await generatePassportSignature(customer.address, "createTask", expiry);

      await expect(
        roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry, signature)
      ).to.be.revertedWithCustomError(roseMarketplace, "SignatureExpired");
    });

    it("Should revert with invalid signature", async function () {
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

      const expiry = await getFutureExpiry();
      // Sign with wrong action
      const signature = await generatePassportSignature(customer.address, "wrongAction", expiry);

      await expect(
        roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry, signature)
      ).to.be.revertedWithCustomError(roseMarketplace, "InvalidSignature");
    });

    it("Should prevent signature replay", async function () {
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit * 2n);

      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(customer.address, "createTask", expiry);

      // First use should succeed
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry, signature);

      // Second use with same signature should fail
      await expect(
        roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry, signature)
      ).to.be.revertedWithCustomError(roseMarketplace, "SignatureAlreadyUsed");
    });

  });

  describe("Task Lifecycle", function () {
    const taskTitle = "Build a website";
    const taskDeposit = ethers.parseEther("1");

    beforeEach(async function () {
      // Create task with signature
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      const createExpiry = await getFutureExpiry();
      const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

      // Stakeholder stakes with signature (vROSE transfers to marketplace escrow)
      const stakeholderDeposit = taskDeposit / 10n;
      // Approve marketplace to pull vROSE for escrow
      await vRose.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
      const stakeExpiry = await getFutureExpiry();
      const stakeSig = await generatePassportSignature(stakeholder.address, "stake", stakeExpiry);
      await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit, stakeExpiry, stakeSig);
    });

    it("Should allow workers to claim tasks", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(worker.address, "claim", expiry);

      await expect(roseMarketplace.connect(worker).claimTask(1, expiry, signature))
        .to.emit(roseMarketplace, "TaskClaimed")
        .withArgs(1, worker.address);

      const task = await roseMarketplace.tasks(1);
      expect(task.worker).to.equal(worker.address);
      expect(task.status).to.equal(2); // TaskStatus.InProgress
    });

    it("Should not allow customers to claim their own tasks", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(customer.address, "claim", expiry);

      await expect(
        roseMarketplace.connect(customer).claimTask(1, expiry, signature)
      ).to.be.revertedWith("Customer cannot claim their own task");
    });

    it("Should not allow stakeholder to claim task they are validating", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(stakeholder.address, "claim", expiry);

      await expect(
        roseMarketplace.connect(stakeholder).claimTask(1, expiry, signature)
      ).to.be.revertedWith("Stakeholder cannot claim task they are validating");
    });

    it("Should allow workers to mark tasks as completed", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(worker.address, "claim", expiry);
      await roseMarketplace.connect(worker).claimTask(1, expiry, signature);

      await expect(roseMarketplace.connect(worker).markTaskCompleted(1, testPrUrl))
        .to.emit(roseMarketplace, "TaskCompleted")
        .withArgs(1, testPrUrl);

      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(3); // TaskStatus.Completed
      expect(task.prUrl).to.equal(testPrUrl);
    });

    it("Should allow customer and stakeholder approvals and mark task ready for payment (customer first)", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(worker.address, "claim", expiry);
      await roseMarketplace.connect(worker).claimTask(1, expiry, signature);
      await roseMarketplace.connect(worker).markTaskCompleted(1, testPrUrl);

      await roseMarketplace.connect(customer).approveCompletionByCustomer(1);

      let task = await roseMarketplace.tasks(1);
      expect(task.customerApproval).to.equal(true);
      expect(task.status).to.equal(3); // Still Completed, not Closed yet

      await expect(roseMarketplace.connect(stakeholder).approveCompletionByStakeholder(1))
        .to.emit(roseMarketplace, "TaskReadyForPayment")
        .withArgs(1, worker.address, taskDeposit);

      task = await roseMarketplace.tasks(1);
      expect(task.stakeholderApproval).to.equal(true);
      expect(task.status).to.equal(5); // TaskStatus.ApprovedPendingPayment
      expect(task.deposit).to.equal(taskDeposit); // Deposit should still be in contract
    });

    it("Should allow stakeholder and customer approvals and mark task ready for payment (stakeholder first)", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(worker.address, "claim", expiry);
      await roseMarketplace.connect(worker).claimTask(1, expiry, signature);
      await roseMarketplace.connect(worker).markTaskCompleted(1, testPrUrl);

      await roseMarketplace.connect(stakeholder).approveCompletionByStakeholder(1);

      let task = await roseMarketplace.tasks(1);
      expect(task.stakeholderApproval).to.equal(true);
      expect(task.status).to.equal(3); // Still Completed, not ready for payment yet

      await expect(roseMarketplace.connect(customer).approveCompletionByCustomer(1))
        .to.emit(roseMarketplace, "TaskReadyForPayment")
        .withArgs(1, worker.address, taskDeposit);

      task = await roseMarketplace.tasks(1);
      expect(task.customerApproval).to.equal(true);
      expect(task.status).to.equal(5); // TaskStatus.ApprovedPendingPayment
      expect(task.deposit).to.equal(taskDeposit); // Deposit should still be in contract
    });

    it("Should allow worker to accept payment after approvals", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(worker.address, "claim", expiry);
      await roseMarketplace.connect(worker).claimTask(1, expiry, signature);
      await roseMarketplace.connect(worker).markTaskCompleted(1, testPrUrl);
      await roseMarketplace.connect(customer).approveCompletionByCustomer(1);
      await roseMarketplace.connect(stakeholder).approveCompletionByStakeholder(1);

      let task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(5); // TaskStatus.ApprovedPendingPayment

      const workerBalanceBefore = await roseToken.balanceOf(worker.address);

      // Calculate expected worker amount with new tokenomics
      // Mint goes directly to DAO, not included in distribution pot
      const mintAmount = (taskDeposit * BigInt(MINT_PERCENTAGE)) / BigInt(SHARE_DENOMINATOR);
      const totalPot = taskDeposit; // Only customer deposit, not including minted amount
      const workerAmount = (totalPot * BigInt(WORKER_SHARE)) / BigInt(SHARE_DENOMINATOR);

      await expect(roseMarketplace.connect(worker).acceptPayment(1))
        .to.emit(roseMarketplace, "TaskClosed")
        .withArgs(1)
        .and.to.emit(roseMarketplace, "PaymentReleased")
        .withArgs(1, worker.address, workerAmount);

      task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(4); // TaskStatus.Closed
      expect(task.deposit).to.equal(0); // Deposit should be transferred to worker

      const workerBalanceAfter = await roseToken.balanceOf(worker.address);
      expect(workerBalanceAfter - workerBalanceBefore).to.equal(workerAmount);
    });

    it("Should mint tokens and distribute according to new tokenomics", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(worker.address, "claim", expiry);
      await roseMarketplace.connect(worker).claimTask(1, expiry, signature);
      await roseMarketplace.connect(worker).markTaskCompleted(1, testPrUrl);

      const workerBalanceBefore = await roseToken.balanceOf(worker.address);
      const stakeholderRoseBalanceBefore = await roseToken.balanceOf(stakeholder.address);
      const stakeholderVRoseBalanceBefore = await vRose.balanceOf(stakeholder.address);
      const marketplaceVRoseBefore = await vRose.balanceOf(await roseMarketplace.getAddress());
      const treasuryBalanceBefore = await roseToken.balanceOf(await roseTreasury.getAddress());

      await roseMarketplace.connect(customer).approveCompletionByCustomer(1);
      await roseMarketplace.connect(stakeholder).approveCompletionByStakeholder(1);
      await roseMarketplace.connect(worker).acceptPayment(1);

      // New tokenomics calculations
      // Mint goes directly to DAO, not included in distribution pot
      const mintAmount = (taskDeposit * BigInt(MINT_PERCENTAGE)) / BigInt(SHARE_DENOMINATOR);
      const totalPot = taskDeposit; // Only customer deposit, not including minted amount
      const workerAmount = (totalPot * BigInt(WORKER_SHARE)) / BigInt(SHARE_DENOMINATOR);
      const stakeholderFee = (totalPot * BigInt(STAKEHOLDER_SHARE)) / BigInt(SHARE_DENOMINATOR);
      const stakeholderDeposit = taskDeposit / 10n;

      // Verify distributions
      // Worker gets 95% of task deposit in ROSE
      expect(await roseToken.balanceOf(worker.address)).to.equal(workerBalanceBefore + workerAmount);
      // Stakeholder gets 5% fee in ROSE (vROSE stake is returned from escrow)
      expect(await roseToken.balanceOf(stakeholder.address)).to.equal(stakeholderRoseBalanceBefore + stakeholderFee);
      // Stakeholder's vROSE is returned from marketplace escrow
      expect(await vRose.balanceOf(stakeholder.address)).to.equal(stakeholderVRoseBalanceBefore + stakeholderDeposit);
      expect(await vRose.balanceOf(await roseMarketplace.getAddress())).to.equal(marketplaceVRoseBefore - stakeholderDeposit);
      // DAO treasury gets 2% minted
      expect(await roseToken.balanceOf(await roseTreasury.getAddress())).to.equal(treasuryBalanceBefore + mintAmount);
    });

    it("Should emit StakeholderFeeEarned event with only the fee amount (not stake refund)", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(worker.address, "claim", expiry);
      await roseMarketplace.connect(worker).claimTask(1, expiry, signature);
      await roseMarketplace.connect(worker).markTaskCompleted(1, testPrUrl);
      await roseMarketplace.connect(customer).approveCompletionByCustomer(1);
      await roseMarketplace.connect(stakeholder).approveCompletionByStakeholder(1);

      // Calculate expected fee (5% of task deposit, NOT including stake refund)
      const stakeholderFee = (taskDeposit * BigInt(STAKEHOLDER_SHARE)) / BigInt(SHARE_DENOMINATOR);

      await expect(roseMarketplace.connect(worker).acceptPayment(1))
        .to.emit(roseMarketplace, "StakeholderFeeEarned")
        .withArgs(1, stakeholder.address, stakeholderFee);
    });

    it("Should allow worker to unclaim a task", async function () {
      // Worker claims the task
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(worker.address, "claim", expiry);
      await roseMarketplace.connect(worker).claimTask(1, expiry, signature);

      let task = await roseMarketplace.tasks(1);
      expect(task.worker).to.equal(worker.address);
      expect(task.status).to.equal(2); // TaskStatus.InProgress

      // Worker unclaims the task
      await expect(roseMarketplace.connect(worker).unclaimTask(1))
        .to.emit(roseMarketplace, "TaskUnclaimed")
        .withArgs(1, worker.address);

      task = await roseMarketplace.tasks(1);
      expect(task.worker).to.equal(ethers.ZeroAddress);
      expect(task.status).to.equal(0); // TaskStatus.Open
    });

    it("Should allow another worker to claim after unclaim", async function () {
      const [, , , , , otherWorker] = await ethers.getSigners();

      // First worker claims
      const expiry1 = await getFutureExpiry();
      const signature1 = await generatePassportSignature(worker.address, "claim", expiry1);
      await roseMarketplace.connect(worker).claimTask(1, expiry1, signature1);

      // First worker unclaims
      await roseMarketplace.connect(worker).unclaimTask(1);

      // Second worker can now claim
      const expiry2 = await getFutureExpiry();
      const signature2 = await generatePassportSignature(otherWorker.address, "claim", expiry2);
      await expect(roseMarketplace.connect(otherWorker).claimTask(1, expiry2, signature2))
        .to.emit(roseMarketplace, "TaskClaimed")
        .withArgs(1, otherWorker.address);

      const task = await roseMarketplace.tasks(1);
      expect(task.worker).to.equal(otherWorker.address);
    });

    it("Should not allow non-worker to unclaim task", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(worker.address, "claim", expiry);
      await roseMarketplace.connect(worker).claimTask(1, expiry, signature);

      await expect(
        roseMarketplace.connect(customer).unclaimTask(1)
      ).to.be.revertedWith("Only assigned worker can unclaim");
    });

    it("Should not allow unclaiming completed task", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(worker.address, "claim", expiry);
      await roseMarketplace.connect(worker).claimTask(1, expiry, signature);
      await roseMarketplace.connect(worker).markTaskCompleted(1, testPrUrl);

      await expect(
        roseMarketplace.connect(worker).unclaimTask(1)
      ).to.be.revertedWith("Task must be in progress to unclaim");
    });

    it("Should reject task completion with empty PR URL", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(worker.address, "claim", expiry);
      await roseMarketplace.connect(worker).claimTask(1, expiry, signature);

      await expect(
        roseMarketplace.connect(worker).markTaskCompleted(1, "")
      ).to.be.revertedWith("PR URL cannot be empty");

      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(2); // Still InProgress
    });

    it("Should store PR URL when task is marked completed", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(worker.address, "claim", expiry);
      await roseMarketplace.connect(worker).claimTask(1, expiry, signature);
      await roseMarketplace.connect(worker).markTaskCompleted(1, testPrUrl);

      const task = await roseMarketplace.tasks(1);
      expect(task.prUrl).to.equal(testPrUrl);
    });

    it("Should emit PR URL in TaskCompleted event", async function () {
      const expiry = await getFutureExpiry();
      const signature = await generatePassportSignature(worker.address, "claim", expiry);
      await roseMarketplace.connect(worker).claimTask(1, expiry, signature);

      await expect(roseMarketplace.connect(worker).markTaskCompleted(1, testPrUrl))
        .to.emit(roseMarketplace, "TaskCompleted")
        .withArgs(1, testPrUrl);
    });

  });

  describe("Task Cancellation", function () {
    const taskTitle = "Build a website";
    const taskDeposit = ethers.parseEther("1");

    it("Should allow customer to cancel task in StakeholderRequired status", async function () {
      // Customer creates a task
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      const expiry = await getFutureExpiry();
      const sig = await generatePassportSignature(customer.address, "createTask", expiry);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry, sig);

      const customerBalanceBefore = await roseToken.balanceOf(customer.address);

      // Customer cancels the task
      await expect(roseMarketplace.connect(customer).cancelTask(1))
        .to.emit(roseMarketplace, "TaskCancelled")
        .withArgs(1, customer.address, taskDeposit, 0);

      // Check task status is Closed
      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(4); // TaskStatus.Closed
      expect(task.deposit).to.equal(0);

      // Check customer received refund
      const customerBalanceAfter = await roseToken.balanceOf(customer.address);
      expect(customerBalanceAfter).to.equal(customerBalanceBefore + taskDeposit);
    });

    it("Should allow customer to cancel task in Open status (after stakeholder stakes)", async function () {
      // Customer creates a task
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      const createExpiry = await getFutureExpiry();
      const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

      // Stakeholder stakes (vROSE transferred to marketplace escrow)
      const stakeholderDeposit = taskDeposit / 10n;
      await vRose.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
      const stakeExpiry = await getFutureExpiry();
      const stakeSig = await generatePassportSignature(stakeholder.address, "stake", stakeExpiry);
      await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit, stakeExpiry, stakeSig);

      const customerBalanceBefore = await roseToken.balanceOf(customer.address);
      const stakeholderVRoseBefore = await vRose.balanceOf(stakeholder.address);

      // Customer cancels the task
      await expect(roseMarketplace.connect(customer).cancelTask(1))
        .to.emit(roseMarketplace, "TaskCancelled")
        .withArgs(1, customer.address, taskDeposit, stakeholderDeposit);

      // Check task status is Closed
      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(4); // TaskStatus.Closed
      expect(task.deposit).to.equal(0);
      expect(task.stakeholderDeposit).to.equal(0);

      // Check customer got ROSE refund
      const customerBalanceAfter = await roseToken.balanceOf(customer.address);
      expect(customerBalanceAfter).to.equal(customerBalanceBefore + taskDeposit);

      // Check stakeholder's vROSE was returned from escrow
      const stakeholderVRoseAfter = await vRose.balanceOf(stakeholder.address);
      expect(stakeholderVRoseAfter).to.equal(stakeholderVRoseBefore + stakeholderDeposit);
    });

    it("Should allow stakeholder to cancel task in Open status", async function () {
      // Customer creates a task
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      const createExpiry = await getFutureExpiry();
      const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

      // Stakeholder stakes (vROSE transferred to marketplace escrow)
      const stakeholderDeposit = taskDeposit / 10n;
      await vRose.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
      const stakeExpiry = await getFutureExpiry();
      const stakeSig = await generatePassportSignature(stakeholder.address, "stake", stakeExpiry);
      await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit, stakeExpiry, stakeSig);

      const customerBalanceBefore = await roseToken.balanceOf(customer.address);
      const stakeholderVRoseBefore = await vRose.balanceOf(stakeholder.address);

      // Stakeholder cancels the task
      await expect(roseMarketplace.connect(stakeholder).cancelTask(1))
        .to.emit(roseMarketplace, "TaskCancelled")
        .withArgs(1, stakeholder.address, taskDeposit, stakeholderDeposit);

      // Check task status is Closed
      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(4); // TaskStatus.Closed

      // Check customer got ROSE refund
      const customerBalanceAfter = await roseToken.balanceOf(customer.address);
      expect(customerBalanceAfter).to.equal(customerBalanceBefore + taskDeposit);

      // Check stakeholder's vROSE was returned from escrow
      const stakeholderVRoseAfter = await vRose.balanceOf(stakeholder.address);
      expect(stakeholderVRoseAfter).to.equal(stakeholderVRoseBefore + stakeholderDeposit);
    });

    it("Should refund customer deposit when cancelled", async function () {
      // Customer creates a task
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      const expiry = await getFutureExpiry();
      const sig = await generatePassportSignature(customer.address, "createTask", expiry);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry, sig);

      const customerBalanceBefore = await roseToken.balanceOf(customer.address);

      // Customer cancels
      await roseMarketplace.connect(customer).cancelTask(1);

      // Verify refund
      const customerBalanceAfter = await roseToken.balanceOf(customer.address);
      expect(customerBalanceAfter).to.equal(customerBalanceBefore + taskDeposit);
    });

    it("Should refund customer and return stakeholder vROSE when cancelled after staking", async function () {
      // Customer creates a task
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      const createExpiry = await getFutureExpiry();
      const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

      // Stakeholder stakes (vROSE transferred to marketplace escrow)
      const stakeholderDeposit = taskDeposit / 10n;
      await vRose.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
      const stakeExpiry = await getFutureExpiry();
      const stakeSig = await generatePassportSignature(stakeholder.address, "stake", stakeExpiry);
      await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit, stakeExpiry, stakeSig);

      const customerBalanceBefore = await roseToken.balanceOf(customer.address);
      const stakeholderVRoseBefore = await vRose.balanceOf(stakeholder.address);

      // Cancel
      await roseMarketplace.connect(customer).cancelTask(1);

      // Verify customer ROSE refund
      const customerBalanceAfter = await roseToken.balanceOf(customer.address);
      expect(customerBalanceAfter).to.equal(customerBalanceBefore + taskDeposit);

      // Verify stakeholder vROSE returned from escrow
      const stakeholderVRoseAfter = await vRose.balanceOf(stakeholder.address);
      expect(stakeholderVRoseAfter).to.equal(stakeholderVRoseBefore + stakeholderDeposit);
    });

    it("Should NOT allow cancellation if worker has claimed", async function () {
      // Setup task with stakeholder
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      const createExpiry = await getFutureExpiry();
      const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

      // Stakeholder stakes (vROSE transferred to marketplace escrow)
      const stakeholderDeposit = taskDeposit / 10n;
      await vRose.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
      const stakeExpiry = await getFutureExpiry();
      const stakeSig = await generatePassportSignature(stakeholder.address, "stake", stakeExpiry);
      await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit, stakeExpiry, stakeSig);

      // Worker claims the task (changes status to InProgress)
      const claimExpiry = await getFutureExpiry();
      const claimSig = await generatePassportSignature(worker.address, "claim", claimExpiry);
      await roseMarketplace.connect(worker).claimTask(1, claimExpiry, claimSig);

      // Try to cancel - should fail because status is now InProgress
      await expect(
        roseMarketplace.connect(customer).cancelTask(1)
      ).to.be.revertedWith("Task can only be cancelled in StakeholderRequired or Open status");

      await expect(
        roseMarketplace.connect(stakeholder).cancelTask(1)
      ).to.be.revertedWith("Task can only be cancelled in StakeholderRequired or Open status");
    });

    it("Should NOT allow cancellation by random address", async function () {
      // Customer creates a task
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      const expiry = await getFutureExpiry();
      const sig = await generatePassportSignature(customer.address, "createTask", expiry);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry, sig);

      // Random address tries to cancel
      await expect(
        roseMarketplace.connect(worker).cancelTask(1)
      ).to.be.revertedWith("Only customer or stakeholder can cancel task");
    });

    it("Should NOT allow cancellation if task is already closed", async function () {
      // Customer creates a task
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      const expiry = await getFutureExpiry();
      const sig = await generatePassportSignature(customer.address, "createTask", expiry);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry, sig);

      // Cancel once
      await roseMarketplace.connect(customer).cancelTask(1);

      // Try to cancel again - should fail
      await expect(
        roseMarketplace.connect(customer).cancelTask(1)
      ).to.be.revertedWith("Task can only be cancelled in StakeholderRequired or Open status");
    });

    it("Should emit TaskCancelled event with correct parameters", async function () {
      // Test 1: Cancellation before stakeholder stakes
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      const expiry1 = await getFutureExpiry();
      const sig1 = await generatePassportSignature(customer.address, "createTask", expiry1);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry1, sig1);

      await expect(roseMarketplace.connect(customer).cancelTask(1))
        .to.emit(roseMarketplace, "TaskCancelled")
        .withArgs(1, customer.address, taskDeposit, 0);

      // Test 2: Cancellation after stakeholder stakes (vROSE escrow)
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      const expiry2 = await getFutureExpiry();
      const sig2 = await generatePassportSignature(customer.address, "createTask", expiry2);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry2, sig2);

      const stakeholderDeposit = taskDeposit / 10n;
      await vRose.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
      const stakeExpiry = await getFutureExpiry();
      const stakeSig = await generatePassportSignature(stakeholder.address, "stake", stakeExpiry);
      await roseMarketplace.connect(stakeholder).stakeholderStake(2, stakeholderDeposit, stakeExpiry, stakeSig);

      await expect(roseMarketplace.connect(stakeholder).cancelTask(2))
        .to.emit(roseMarketplace, "TaskCancelled")
        .withArgs(2, stakeholder.address, taskDeposit, stakeholderDeposit);
    });

  });

  describe("Passport Signer Administration", function () {
    it("Should allow owner to update passport signer", async function () {
      const [, , , , , newSigner] = await ethers.getSigners();

      await roseMarketplace.connect(owner).setPassportSigner(newSigner.address);
      expect(await roseMarketplace.passportSigner()).to.equal(newSigner.address);
    });

    it("Should reject zero address for passport signer", async function () {
      await expect(
        roseMarketplace.connect(owner).setPassportSigner(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(roseMarketplace, "ZeroAddressSigner");
    });

    it("Should reject non-owner from updating passport signer", async function () {
      const [, , , , , newSigner] = await ethers.getSigners();

      await expect(
        roseMarketplace.connect(customer).setPassportSigner(newSigner.address)
      ).to.be.revertedWithCustomError(roseMarketplace, "OwnableUnauthorizedAccount");
    });

    it("Should return correct passport signer address", async function () {
      expect(await roseMarketplace.passportSigner()).to.equal(passportSigner.address);
    });
  });
});
