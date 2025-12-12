const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Task Lifecycle Edge Cases", function () {
  let roseMarketplace;
  let roseToken;
  let roseTreasury;
  let vRose;
  let governance;
  let reputation;
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
  let otherUser;
  let passportSigner;

  const taskTitle = "Build a website";
  const taskDeposit = ethers.parseEther("1");
  const ipfsHash = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
  const testPrUrl = "https://github.com/test/repo/pull/123";

  // Nonce for unique expiry values
  let signatureNonce = 0;

  // Helper function to get ROSE tokens via Treasury deposit
  async function getRoseTokens(user, usdcAmount) {
    await usdc.mint(user.address, usdcAmount);
    await usdc.connect(user).approve(await roseTreasury.getAddress(), usdcAmount);
    await roseTreasury.connect(user).deposit(usdcAmount);
  }

  // Helper function to generate passport signature
  async function generatePassportSignature(userAddress, action, expiry) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "string", "uint256"],
      [userAddress, action, expiry]
    );
    const signature = await passportSigner.signMessage(ethers.getBytes(messageHash));
    return signature;
  }

  // Helper to get unique future expiry timestamp (uses blockchain time, not JS time)
  async function getFutureExpiry() {
    signatureNonce++;
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + 3600 + signatureNonce;
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
    [owner, customer, worker, stakeholder, otherUser, passportSigner] = await ethers.getSigners();
    signatureNonce = 0;

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
    btcFeed = await MockV3Aggregator.deploy(8, 4300000000000n);
    ethFeed = await MockV3Aggregator.deploy(8, 230000000000n);
    xauFeed = await MockV3Aggregator.deploy(8, 200000000000n);

    // 4. Deploy mock Uniswap router
    const MockUniswapV3Router = await ethers.getContractFactory("MockUniswapV3Router");
    swapRouter = await MockUniswapV3Router.deploy();

    // 5. Set token decimals and exchange rates on router
    await swapRouter.setTokenDecimals(await usdc.getAddress(), 6);
    await swapRouter.setTokenDecimals(await tbtc.getAddress(), 8);
    await swapRouter.setTokenDecimals(await reth.getAddress(), 18);
    await swapRouter.setTokenDecimals(await paxg.getAddress(), 18);
    await swapRouter.setExchangeRate(await usdc.getAddress(), await tbtc.getAddress(), 2326n * 10n**12n);
    await swapRouter.setExchangeRate(await usdc.getAddress(), await reth.getAddress(), 435n * 10n**24n);
    await swapRouter.setExchangeRate(await usdc.getAddress(), await paxg.getAddress(), 5n * 10n**26n);

    // 6. Fund router with tokens for swaps
    await tbtc.mint(await swapRouter.getAddress(), ethers.parseUnits("1000", 8));
    await reth.mint(await swapRouter.getAddress(), ethers.parseUnits("100000", 18));
    await paxg.mint(await swapRouter.getAddress(), ethers.parseUnits("100000", 18));

    // 7. Deploy RoseTreasury (new constructor: roseToken, usdc, swapRouter)
    const RoseTreasury = await ethers.getContractFactory("RoseTreasury");
    roseTreasury = await RoseTreasury.deploy(
      await roseToken.getAddress(),
      await usdc.getAddress(),
      await swapRouter.getAddress()
    );

    // 7.5 Register assets via addAsset()
    const BTC_KEY = ethers.encodeBytes32String("BTC");
    const GOLD_KEY = ethers.encodeBytes32String("GOLD");
    const STABLE_KEY = ethers.encodeBytes32String("STABLE");
    const ROSE_KEY = ethers.encodeBytes32String("ROSE");

    await roseTreasury.addAsset(BTC_KEY, await tbtc.getAddress(), await btcFeed.getAddress(), 8, 3000);
    await roseTreasury.addAsset(GOLD_KEY, await paxg.getAddress(), await xauFeed.getAddress(), 18, 3000);
    await roseTreasury.addAsset(STABLE_KEY, await usdc.getAddress(), ethers.ZeroAddress, 6, 2000);
    await roseTreasury.addAsset(ROSE_KEY, await roseToken.getAddress(), ethers.ZeroAddress, 18, 2000);

    // 8. Deploy vROSE soulbound token
    const VROSE = await ethers.getContractFactory("vROSE");
    vRose = await VROSE.deploy();

    // 9. Deploy RoseMarketplace (Treasury is the DAO treasury, passportSigner for verification)
    const RoseMarketplace = await ethers.getContractFactory("RoseMarketplace");
    roseMarketplace = await RoseMarketplace.deploy(
      await roseToken.getAddress(),
      await roseTreasury.getAddress(),
      passportSigner.address
    );

    // 9.5 Deploy RoseReputation (needed by Governance)
    const RoseReputation = await ethers.getContractFactory("RoseReputation");
    reputation = await RoseReputation.deploy(
      owner.address, // temporary governance (will update)
      await roseMarketplace.getAddress(),
      passportSigner.address
    );

    // 10. Deploy RoseGovernance
    const RoseGovernance = await ethers.getContractFactory("RoseGovernance");
    governance = await RoseGovernance.deploy(
      await roseToken.getAddress(),
      await vRose.getAddress(),
      await roseMarketplace.getAddress(),
      await roseTreasury.getAddress(),
      passportSigner.address,
      await reputation.getAddress()
    );

    // 10.5 Update reputation to point to actual governance
    await reputation.setGovernance(await governance.getAddress());

    // 11. Set up vROSE with governance and marketplace
    await vRose.setGovernance(await governance.getAddress());
    await vRose.setMarketplace(await roseMarketplace.getAddress());

    // 12. Set vROSE and governance on marketplace
    await roseMarketplace.setVRoseToken(await vRose.getAddress());
    await roseMarketplace.setGovernance(await governance.getAddress());

    // 12.5 Set reputation on marketplace
    await roseMarketplace.setReputation(await reputation.getAddress());

    // 13. Authorize Treasury, Marketplace, and Governance on RoseToken
    await roseToken.setAuthorized(await roseTreasury.getAddress(), true);
    await roseToken.setAuthorized(await roseMarketplace.getAddress(), true);
    await roseToken.setAuthorized(await governance.getAddress(), true);

    // 14. Get ROSE tokens via Treasury deposit
    const depositAmount = ethers.parseUnits("100000", 6);
    await getRoseTokens(customer, depositAmount);
    await getRoseTokens(stakeholder, depositAmount);

    // 15. Stakeholder needs vROSE for staking - deposit ROSE to governance
    const stakeholderVRoseAmount = ethers.parseEther("10000");
    await roseToken.connect(stakeholder).approve(await governance.getAddress(), stakeholderVRoseAmount);
    await governance.connect(stakeholder).deposit(stakeholderVRoseAmount);
  });

  it("Should not allow creating a task with zero deposit", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

    const expiry = await getFutureExpiry();
    const sig = await generatePassportSignature(customer.address, "createTask", expiry);

    await expect(
      roseMarketplace.connect(customer).createTask(taskTitle, 0, ipfsHash, expiry, sig)
    ).to.be.reverted;
  });

  it("Should not allow stakeholder to stake without sufficient vROSE", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    const createExpiry = await getFutureExpiry();
    const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

    // otherUser has no vROSE, should fail (even with approval since they have no balance)
    const stakeholderDeposit = taskDeposit / 10n;
    await vRose.connect(otherUser).approve(await roseMarketplace.getAddress(), stakeholderDeposit);

    const stakeExpiry = await getFutureExpiry();
    const stakeSig = await generatePassportSignature(otherUser.address, "stake", stakeExpiry);

    await expect(
      roseMarketplace.connect(otherUser).stakeholderStake(1, stakeholderDeposit, stakeExpiry, stakeSig)
    ).to.be.revertedWithCustomError(roseMarketplace, "InsufficientVRose");
  });

  it("Should not allow a non-authorized address to mint tokens", async function() {
    await expect(
      roseToken.connect(customer).mint(customer.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(roseToken, "NotAuthorized");
  });

  it("Should not allow customer to claim their own task", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    const createExpiry = await getFutureExpiry();
    const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

    // Stakeholder stakes with vROSE (approve marketplace for escrow)
    const stakeholderDeposit = taskDeposit / 10n;
    await vRose.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    const stakeExpiry = await getFutureExpiry();
    const stakeSig = await generatePassportSignature(stakeholder.address, "stake", stakeExpiry);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit, stakeExpiry, stakeSig);

    const claimExpiry = await getFutureExpiry();
    const claimSig = await generatePassportSignature(customer.address, "claim", claimExpiry);

    await expect(
      roseMarketplace.connect(customer).claimTask(1, claimExpiry, claimSig)
    ).to.be.revertedWith("Customer cannot claim their own task");
  });

  it("Should not allow stakeholder to be the customer", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    const createExpiry = await getFutureExpiry();
    const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

    // Customer would need vROSE to stake - give them some
    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(customer).approve(await governance.getAddress(), ethers.parseEther("1"));
    await governance.connect(customer).deposit(ethers.parseEther("1"));
    await vRose.connect(customer).approve(await roseMarketplace.getAddress(), stakeholderDeposit);

    const stakeExpiry = await getFutureExpiry();
    const stakeSig = await generatePassportSignature(customer.address, "stake", stakeExpiry);

    await expect(
      roseMarketplace.connect(customer).stakeholderStake(1, stakeholderDeposit, stakeExpiry, stakeSig)
    ).to.be.revertedWith("Customer cannot be stakeholder for their own task");
  });

  it("Should not allow wrong deposit amount for stakeholder", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    const createExpiry = await getFutureExpiry();
    const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

    const wrongDeposit = taskDeposit / 5n;
    await vRose.connect(stakeholder).approve(await roseMarketplace.getAddress(), wrongDeposit);

    const stakeExpiry = await getFutureExpiry();
    const stakeSig = await generatePassportSignature(stakeholder.address, "stake", stakeExpiry);

    await expect(
      roseMarketplace.connect(stakeholder).stakeholderStake(1, wrongDeposit, stakeExpiry, stakeSig)
    ).to.be.revertedWith("Must deposit exactly 10% of task value");
  });

  it("Should not allow non-worker to mark task as completed", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    const createExpiry = await getFutureExpiry();
    const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

    // Stakeholder stakes with vROSE (approve marketplace for escrow)
    const stakeholderDeposit = taskDeposit / 10n;
    await vRose.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    const stakeExpiry = await getFutureExpiry();
    const stakeSig = await generatePassportSignature(stakeholder.address, "stake", stakeExpiry);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit, stakeExpiry, stakeSig);

    const claimExpiry = await getFutureExpiry();
    const claimSig = await generatePassportSignature(worker.address, "claim", claimExpiry);
    await roseMarketplace.connect(worker).claimTask(1, claimExpiry, claimSig);

    await expect(
      roseMarketplace.connect(otherUser).markTaskCompleted(1, testPrUrl)
    ).to.be.revertedWith("Only assigned worker can mark completion");
  });

  it("Should enforce all three roles (customer, stakeholder, worker) are different addresses", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    const createExpiry = await getFutureExpiry();
    const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

    // Customer would need vROSE to stake - give them some
    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(customer).approve(await governance.getAddress(), ethers.parseEther("1"));
    await governance.connect(customer).deposit(ethers.parseEther("1"));
    await vRose.connect(customer).approve(await roseMarketplace.getAddress(), stakeholderDeposit);

    const custStakeExpiry = await getFutureExpiry();
    const custStakeSig = await generatePassportSignature(customer.address, "stake", custStakeExpiry);
    await expect(
      roseMarketplace.connect(customer).stakeholderStake(1, stakeholderDeposit, custStakeExpiry, custStakeSig)
    ).to.be.revertedWith("Customer cannot be stakeholder for their own task");

    // Stakeholder stakes with vROSE (approve marketplace for escrow)
    await vRose.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    const stakeExpiry = await getFutureExpiry();
    const stakeSig = await generatePassportSignature(stakeholder.address, "stake", stakeExpiry);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit, stakeExpiry, stakeSig);

    const custClaimExpiry = await getFutureExpiry();
    const custClaimSig = await generatePassportSignature(customer.address, "claim", custClaimExpiry);
    await expect(
      roseMarketplace.connect(customer).claimTask(1, custClaimExpiry, custClaimSig)
    ).to.be.revertedWith("Customer cannot claim their own task");

    const stakeClaimExpiry = await getFutureExpiry();
    const stakeClaimSig = await generatePassportSignature(stakeholder.address, "claim", stakeClaimExpiry);
    await expect(
      roseMarketplace.connect(stakeholder).claimTask(1, stakeClaimExpiry, stakeClaimSig)
    ).to.be.revertedWith("Stakeholder cannot claim task they are validating");

    const claimExpiry = await getFutureExpiry();
    const claimSig = await generatePassportSignature(worker.address, "claim", claimExpiry);
    await roseMarketplace.connect(worker).claimTask(1, claimExpiry, claimSig);

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
    const createExpiry = await getFutureExpiry();
    const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

    // Stakeholder stakes with vROSE (approve marketplace for escrow)
    const stakeholderDeposit = taskDeposit / 10n;
    await vRose.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    const stakeExpiry = await getFutureExpiry();
    const stakeSig = await generatePassportSignature(stakeholder.address, "stake", stakeExpiry);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit, stakeExpiry, stakeSig);

    await expect(
      roseMarketplace.connect(worker).unclaimTask(1)
    ).to.be.revertedWith("Only assigned worker can unclaim");
  });
});
