const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Task Detailed Description", function () {
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

  it("Should create a task with mandatory IPFS hash", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

    await expect(
      roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash)
    )
      .to.emit(roseMarketplace, "TaskCreated")
      .withArgs(1, customer.address, taskDeposit);

    const task = await roseMarketplace.tasks(1);
    expect(task.title).to.equal(taskTitle);
    expect(task.detailedDescriptionHash).to.equal(ipfsHash);
  });

  it("Should revert if detailed description hash is empty", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

    await expect(
      roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, "")
    ).to.be.revertedWith("Detailed description hash is required");
  });

  it("Should revert if title is empty", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

    await expect(
      roseMarketplace.connect(customer).createTask("", taskDeposit, ipfsHash)
    ).to.be.revertedWith("Title cannot be empty");
  });

  it("Should return true for isTaskParticipant when customer", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    expect(await roseMarketplace.connect(customer).isTaskParticipant(1)).to.equal(true);
  });

  it("Should return true for isTaskParticipant when stakeholder", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

    expect(await roseMarketplace.connect(stakeholder).isTaskParticipant(1)).to.equal(true);
  });

  it("Should return true for isTaskParticipant when worker", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

    await roseMarketplace.connect(worker).claimTask(1);

    expect(await roseMarketplace.connect(worker).isTaskParticipant(1)).to.equal(true);
  });

  it("Should return false for isTaskParticipant when not a participant", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    expect(await roseMarketplace.connect(otherUser).isTaskParticipant(1)).to.equal(false);
  });
});
