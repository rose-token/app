const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Task Lifecycle Edge Cases", function () {
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
  let otherUser;

  const taskTitle = "Build a website";
  const taskDeposit = ethers.parseEther("1");
  const ipfsHash = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
  const testPrUrl = "https://github.com/test/repo/pull/123";

  // Helper function to get ROSE tokens via Treasury deposit
  async function getRoseTokens(user, usdcAmount) {
    await usdc.mint(user.address, usdcAmount);
    await usdc.connect(user).approve(await roseTreasury.getAddress(), usdcAmount);
    await roseTreasury.connect(user).deposit(usdcAmount);
  }

  beforeEach(async function () {
    [owner, customer, worker, stakeholder, otherUser] = await ethers.getSigners();

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
    btcFeed = await MockV3Aggregator.deploy(8, 4300000000000n);
    ethFeed = await MockV3Aggregator.deploy(8, 230000000000n);
    xauFeed = await MockV3Aggregator.deploy(8, 200000000000n);

    // 4. Deploy mock Uniswap router
    const MockUniswapV3Router = await ethers.getContractFactory("MockUniswapV3Router");
    swapRouter = await MockUniswapV3Router.deploy();

    // 5. Set token decimals and exchange rates on router
    await swapRouter.setTokenDecimals(await usdc.getAddress(), 6);
    await swapRouter.setTokenDecimals(await wbtc.getAddress(), 8);
    await swapRouter.setTokenDecimals(await reth.getAddress(), 18);
    await swapRouter.setTokenDecimals(await paxg.getAddress(), 18);
    await swapRouter.setExchangeRate(await usdc.getAddress(), await wbtc.getAddress(), 2326n * 10n**12n);
    await swapRouter.setExchangeRate(await usdc.getAddress(), await reth.getAddress(), 435n * 10n**24n);
    await swapRouter.setExchangeRate(await usdc.getAddress(), await paxg.getAddress(), 5n * 10n**26n);

    // 6. Fund router with tokens for swaps
    await wbtc.mint(await swapRouter.getAddress(), ethers.parseUnits("1000", 8));
    await reth.mint(await swapRouter.getAddress(), ethers.parseUnits("100000", 18));
    await paxg.mint(await swapRouter.getAddress(), ethers.parseUnits("100000", 18));

    // 7. Deploy RoseTreasury
    const RoseTreasury = await ethers.getContractFactory("RoseTreasury");
    roseTreasury = await RoseTreasury.deploy(
      await roseToken.getAddress(),
      await usdc.getAddress(),
      await wbtc.getAddress(),
      await reth.getAddress(),
      await paxg.getAddress(),
      await btcFeed.getAddress(),
      await ethFeed.getAddress(),
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
    const depositAmount = ethers.parseUnits("100000", 6);
    await getRoseTokens(customer, depositAmount);
    await getRoseTokens(stakeholder, depositAmount);
  });

  it("Should not allow creating a task with zero deposit", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

    await expect(
      roseMarketplace.connect(customer).createTask(taskTitle, 0, ipfsHash)
    ).to.be.reverted;
  });

  it("Should not allow stakeholder to stake without sufficient approval", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    const stakeholderDeposit = taskDeposit / 10n;

    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit - 1n);

    await expect(
      roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit)
    ).to.be.reverted;
  });

  it("Should not allow a non-authorized address to mint tokens", async function() {
    await expect(
      roseToken.connect(customer).mint(customer.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(roseToken, "NotAuthorized");
  });

  it("Should not allow customer to claim their own task", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

    await expect(
      roseMarketplace.connect(customer).claimTask(1)
    ).to.be.revertedWith("Customer cannot claim their own task");
  });

  it("Should not allow stakeholder to be the customer", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), stakeholderDeposit);

    await expect(
      roseMarketplace.connect(customer).stakeholderStake(1, stakeholderDeposit)
    ).to.be.revertedWith("Customer cannot be stakeholder for their own task");
  });

  it("Should not allow wrong deposit amount for stakeholder", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    const wrongDeposit = taskDeposit / 5n;
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), wrongDeposit);

    await expect(
      roseMarketplace.connect(stakeholder).stakeholderStake(1, wrongDeposit)
    ).to.be.revertedWith("Must deposit exactly 10% of task value");
  });

  it("Should not allow non-worker to mark task as completed", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

    await roseMarketplace.connect(worker).claimTask(1);

    await expect(
      roseMarketplace.connect(otherUser).markTaskCompleted(1, testPrUrl)
    ).to.be.revertedWith("Only assigned worker can mark completion");
  });

  it("Should enforce all three roles (customer, stakeholder, worker) are different addresses", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await expect(
      roseMarketplace.connect(customer).stakeholderStake(1, stakeholderDeposit)
    ).to.be.revertedWith("Customer cannot be stakeholder for their own task");

    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

    await expect(
      roseMarketplace.connect(customer).claimTask(1)
    ).to.be.revertedWith("Customer cannot claim their own task");

    await expect(
      roseMarketplace.connect(stakeholder).claimTask(1)
    ).to.be.revertedWith("Stakeholder cannot claim task they are validating");

    await roseMarketplace.connect(worker).claimTask(1);

    const task = await roseMarketplace.tasks(1);
    expect(task.customer).to.equal(customer.address);
    expect(task.stakeholder).to.equal(stakeholder.address);
    expect(task.worker).to.equal(worker.address);

    expect(task.customer).to.not.equal(task.stakeholder);
    expect(task.customer).to.not.equal(task.worker);
    expect(task.stakeholder).to.not.equal(task.worker);
  });

  it("Should not allow unclaiming task that was never claimed", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

    await expect(
      roseMarketplace.connect(worker).unclaimTask(1)
    ).to.be.revertedWith("Only assigned worker can unclaim");
  });
});
