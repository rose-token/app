const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RoseMarketplace", function () {
  let roseMarketplace;
  let roseToken;
  let roseTreasury;
  let usdc;
  let wbtc;
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

  beforeEach(async function () {
    [owner, customer, worker, stakeholder] = await ethers.getSigners();
    burnAddress = "0x000000000000000000000000000000000000dEaD";

    // 1. Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    wbtc = await MockERC20.deploy("Wrapped BTC", "WBTC", 8);
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
    await swapRouter.setTokenDecimals(await wbtc.getAddress(), 8);
    await swapRouter.setTokenDecimals(await reth.getAddress(), 18);
    await swapRouter.setTokenDecimals(await paxg.getAddress(), 18);

    // 6. Set exchange rates on router (based on mock prices)
    // Formula: amountOut = (amountIn * rate) / 1e18
    // BTC = $43,000: For 1 USDC (1e6), we want 1/43000 BTC (in 8 dec) = 1e8/43000 ≈ 2326
    // rate = 2326 * 1e18 / 1e6 = 2.326e15
    await swapRouter.setExchangeRate(await usdc.getAddress(), await wbtc.getAddress(), 2326n * 10n**12n);
    // ETH = $2,300: For 1 USDC (1e6), we want 1/2300 rETH (in 18 dec) = 1e18/2300 ≈ 4.35e14
    // rate = 4.35e14 * 1e18 / 1e6 = 4.35e26
    await swapRouter.setExchangeRate(await usdc.getAddress(), await reth.getAddress(), 435n * 10n**24n);
    // Gold = $2,000: For 1 USDC (1e6), we want 1/2000 PAXG (in 18 dec) = 1e18/2000 = 5e14
    // rate = 5e14 * 1e18 / 1e6 = 5e26
    await swapRouter.setExchangeRate(await usdc.getAddress(), await paxg.getAddress(), 5n * 10n**26n);

    // 7. Fund router with tokens for swaps (plenty of liquidity)
    await wbtc.mint(await swapRouter.getAddress(), ethers.parseUnits("1000", 8));
    await reth.mint(await swapRouter.getAddress(), ethers.parseUnits("100000", 18));
    await paxg.mint(await swapRouter.getAddress(), ethers.parseUnits("100000", 18));

    // 7. Deploy RoseTreasury
    const RoseTreasury = await ethers.getContractFactory("RoseTreasury");
    roseTreasury = await RoseTreasury.deploy(
      await roseToken.getAddress(),
      await usdc.getAddress(),
      await wbtc.getAddress(),
      await paxg.getAddress(),
      await btcFeed.getAddress(),
      await xauFeed.getAddress(),
      await swapRouter.getAddress()
    );

    // 8. Deploy RoseMarketplace (Treasury is the DAO treasury)
    const RoseMarketplace = await ethers.getContractFactory("RoseMarketplace");
    roseMarketplace = await RoseMarketplace.deploy(
      await roseToken.getAddress(),
      await roseTreasury.getAddress()
    );

    // 9. Authorize Treasury and Marketplace on RoseToken
    await roseToken.setAuthorized(await roseTreasury.getAddress(), true);
    await roseToken.setAuthorized(await roseMarketplace.getAddress(), true);

    // 10. Get ROSE tokens via Treasury deposit
    // Deposit enough USDC to get plenty of ROSE for tests
    // Initial price is $1, so 100,000 USDC -> 100,000 ROSE
    const depositAmount = ethers.parseUnits("100000", 6); // 100,000 USDC
    await getRoseTokens(customer, depositAmount);
    await getRoseTokens(stakeholder, depositAmount);
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

      await expect(
        roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash)
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

      await expect(
        roseMarketplace.connect(customer).createTask(taskTitle, 0, ipfsHash)
      ).to.be.revertedWith("Token amount must be greater than zero");
    });

    it("Should revert if title is empty", async function () {
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

      await expect(
        roseMarketplace.connect(customer).createTask("", taskDeposit, ipfsHash)
      ).to.be.revertedWith("Title cannot be empty");
    });

    it("Should revert if detailed description hash is empty", async function () {
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

      await expect(
        roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, "")
      ).to.be.revertedWith("Detailed description hash is required");
    });

  });

  describe("Task Lifecycle", function () {
    const taskTitle = "Build a website";
    const taskDeposit = ethers.parseEther("1");

    beforeEach(async function () {
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

      const stakeholderDeposit = taskDeposit / 10n;
      await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
      await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);
    });

    it("Should allow workers to claim tasks", async function () {
      await expect(roseMarketplace.connect(worker).claimTask(1))
        .to.emit(roseMarketplace, "TaskClaimed")
        .withArgs(1, worker.address);

      const task = await roseMarketplace.tasks(1);
      expect(task.worker).to.equal(worker.address);
      expect(task.status).to.equal(2); // TaskStatus.InProgress
    });

    it("Should not allow customers to claim their own tasks", async function () {
      await expect(
        roseMarketplace.connect(customer).claimTask(1)
      ).to.be.revertedWith("Customer cannot claim their own task");
    });

    it("Should not allow stakeholder to claim task they are validating", async function () {
      await expect(
        roseMarketplace.connect(stakeholder).claimTask(1)
      ).to.be.revertedWith("Stakeholder cannot claim task they are validating");
    });

    it("Should allow workers to mark tasks as completed", async function () {
      await roseMarketplace.connect(worker).claimTask(1);

      await expect(roseMarketplace.connect(worker).markTaskCompleted(1, testPrUrl))
        .to.emit(roseMarketplace, "TaskCompleted")
        .withArgs(1, testPrUrl);

      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(3); // TaskStatus.Completed
      expect(task.prUrl).to.equal(testPrUrl);
    });

    it("Should allow customer and stakeholder approvals and mark task ready for payment (customer first)", async function () {
      await roseMarketplace.connect(worker).claimTask(1);
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
      await roseMarketplace.connect(worker).claimTask(1);
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
      await roseMarketplace.connect(worker).claimTask(1);
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
      await roseMarketplace.connect(worker).claimTask(1);
      await roseMarketplace.connect(worker).markTaskCompleted(1, testPrUrl);

      const workerBalanceBefore = await roseToken.balanceOf(worker.address);
      const stakeholderBalanceBefore = await roseToken.balanceOf(stakeholder.address);
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
      const stakeholderStakeRefund = taskDeposit / 10n;
      const stakeholderTotal = stakeholderStakeRefund + stakeholderFee;

      // Verify distributions
      expect(await roseToken.balanceOf(worker.address)).to.equal(workerBalanceBefore + workerAmount);
      expect(await roseToken.balanceOf(stakeholder.address)).to.equal(stakeholderBalanceBefore + stakeholderTotal);
      expect(await roseToken.balanceOf(await roseTreasury.getAddress())).to.equal(treasuryBalanceBefore + mintAmount);
    });

    it("Should allow worker to unclaim a task", async function () {
      // Worker claims the task
      await roseMarketplace.connect(worker).claimTask(1);

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
      const [, , , , otherWorker] = await ethers.getSigners();

      // First worker claims
      await roseMarketplace.connect(worker).claimTask(1);

      // First worker unclaims
      await roseMarketplace.connect(worker).unclaimTask(1);

      // Second worker can now claim
      await expect(roseMarketplace.connect(otherWorker).claimTask(1))
        .to.emit(roseMarketplace, "TaskClaimed")
        .withArgs(1, otherWorker.address);

      const task = await roseMarketplace.tasks(1);
      expect(task.worker).to.equal(otherWorker.address);
    });

    it("Should not allow non-worker to unclaim task", async function () {
      await roseMarketplace.connect(worker).claimTask(1);

      await expect(
        roseMarketplace.connect(customer).unclaimTask(1)
      ).to.be.revertedWith("Only assigned worker can unclaim");
    });

    it("Should not allow unclaiming completed task", async function () {
      await roseMarketplace.connect(worker).claimTask(1);
      await roseMarketplace.connect(worker).markTaskCompleted(1, testPrUrl);

      await expect(
        roseMarketplace.connect(worker).unclaimTask(1)
      ).to.be.revertedWith("Task must be in progress to unclaim");
    });

    it("Should reject task completion with empty PR URL", async function () {
      await roseMarketplace.connect(worker).claimTask(1);

      await expect(
        roseMarketplace.connect(worker).markTaskCompleted(1, "")
      ).to.be.revertedWith("PR URL cannot be empty");

      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(2); // Still InProgress
    });

    it("Should store PR URL when task is marked completed", async function () {
      await roseMarketplace.connect(worker).claimTask(1);
      await roseMarketplace.connect(worker).markTaskCompleted(1, testPrUrl);

      const task = await roseMarketplace.tasks(1);
      expect(task.prUrl).to.equal(testPrUrl);
    });

    it("Should emit PR URL in TaskCompleted event", async function () {
      await roseMarketplace.connect(worker).claimTask(1);

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
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

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
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

      // Stakeholder stakes
      const stakeholderDeposit = taskDeposit / 10n;
      await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
      await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

      const customerBalanceBefore = await roseToken.balanceOf(customer.address);
      const stakeholderBalanceBefore = await roseToken.balanceOf(stakeholder.address);

      // Customer cancels the task
      await expect(roseMarketplace.connect(customer).cancelTask(1))
        .to.emit(roseMarketplace, "TaskCancelled")
        .withArgs(1, customer.address, taskDeposit, stakeholderDeposit);

      // Check task status is Closed
      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(4); // TaskStatus.Closed
      expect(task.deposit).to.equal(0);
      expect(task.stakeholderDeposit).to.equal(0);

      // Check both received refunds
      const customerBalanceAfter = await roseToken.balanceOf(customer.address);
      const stakeholderBalanceAfter = await roseToken.balanceOf(stakeholder.address);
      expect(customerBalanceAfter).to.equal(customerBalanceBefore + taskDeposit);
      expect(stakeholderBalanceAfter).to.equal(stakeholderBalanceBefore + stakeholderDeposit);
    });

    it("Should allow stakeholder to cancel task in Open status", async function () {
      // Customer creates a task
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

      // Stakeholder stakes
      const stakeholderDeposit = taskDeposit / 10n;
      await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
      await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

      const customerBalanceBefore = await roseToken.balanceOf(customer.address);
      const stakeholderBalanceBefore = await roseToken.balanceOf(stakeholder.address);

      // Stakeholder cancels the task
      await expect(roseMarketplace.connect(stakeholder).cancelTask(1))
        .to.emit(roseMarketplace, "TaskCancelled")
        .withArgs(1, stakeholder.address, taskDeposit, stakeholderDeposit);

      // Check task status is Closed
      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(4); // TaskStatus.Closed

      // Check both received refunds
      const customerBalanceAfter = await roseToken.balanceOf(customer.address);
      const stakeholderBalanceAfter = await roseToken.balanceOf(stakeholder.address);
      expect(customerBalanceAfter).to.equal(customerBalanceBefore + taskDeposit);
      expect(stakeholderBalanceAfter).to.equal(stakeholderBalanceBefore + stakeholderDeposit);
    });

    it("Should refund customer deposit when cancelled", async function () {
      // Customer creates a task
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

      const customerBalanceBefore = await roseToken.balanceOf(customer.address);

      // Customer cancels
      await roseMarketplace.connect(customer).cancelTask(1);

      // Verify refund
      const customerBalanceAfter = await roseToken.balanceOf(customer.address);
      expect(customerBalanceAfter).to.equal(customerBalanceBefore + taskDeposit);
    });

    it("Should refund both customer and stakeholder when cancelled after staking", async function () {
      // Customer creates a task
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

      // Stakeholder stakes
      const stakeholderDeposit = taskDeposit / 10n;
      await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
      await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

      const customerBalanceBefore = await roseToken.balanceOf(customer.address);
      const stakeholderBalanceBefore = await roseToken.balanceOf(stakeholder.address);

      // Cancel
      await roseMarketplace.connect(customer).cancelTask(1);

      // Verify both refunds
      const customerBalanceAfter = await roseToken.balanceOf(customer.address);
      const stakeholderBalanceAfter = await roseToken.balanceOf(stakeholder.address);
      expect(customerBalanceAfter).to.equal(customerBalanceBefore + taskDeposit);
      expect(stakeholderBalanceAfter).to.equal(stakeholderBalanceBefore + stakeholderDeposit);
    });

    it("Should NOT allow cancellation if worker has claimed", async function () {
      // Setup task with stakeholder
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

      const stakeholderDeposit = taskDeposit / 10n;
      await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
      await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

      // Worker claims the task (changes status to InProgress)
      await roseMarketplace.connect(worker).claimTask(1);

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
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

      // Random address tries to cancel
      await expect(
        roseMarketplace.connect(worker).cancelTask(1)
      ).to.be.revertedWith("Only customer or stakeholder can cancel task");
    });

    it("Should NOT allow cancellation if task is already closed", async function () {
      // Customer creates a task
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

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
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

      await expect(roseMarketplace.connect(customer).cancelTask(1))
        .to.emit(roseMarketplace, "TaskCancelled")
        .withArgs(1, customer.address, taskDeposit, 0);

      // Test 2: Cancellation after stakeholder stakes
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
      await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

      const stakeholderDeposit = taskDeposit / 10n;
      await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
      await roseMarketplace.connect(stakeholder).stakeholderStake(2, stakeholderDeposit);

      await expect(roseMarketplace.connect(stakeholder).cancelTask(2))
        .to.emit(roseMarketplace, "TaskCancelled")
        .withArgs(2, stakeholder.address, taskDeposit, stakeholderDeposit);
    });

  });
});
