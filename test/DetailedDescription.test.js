const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Task Detailed Description", function () {
  let roseMarketplace;
  let roseToken;
  let roseTreasury;
  let vRose;
  let governance;
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
  let passportSigner;

  const taskTitle = "Build a website";
  const taskDeposit = ethers.parseEther("1");
  const ipfsHash = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

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
      await paxg.getAddress(),
      await btcFeed.getAddress(),
      await xauFeed.getAddress(),
      await swapRouter.getAddress()
    );

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

    // 10. Deploy RoseGovernance
    const RoseGovernance = await ethers.getContractFactory("RoseGovernance");
    governance = await RoseGovernance.deploy(
      await roseToken.getAddress(),
      await vRose.getAddress(),
      await roseMarketplace.getAddress(),
      await roseTreasury.getAddress(),
      passportSigner.address
    );

    // 11. Set up vROSE with governance and marketplace
    await vRose.setGovernance(await governance.getAddress());
    await vRose.setMarketplace(await roseMarketplace.getAddress());

    // 12. Set vROSE and governance on marketplace
    await roseMarketplace.setVRoseToken(await vRose.getAddress());
    await roseMarketplace.setGovernance(await governance.getAddress());

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
    const repAttest = await getRepAttestation(stakeholder);
    await governance.connect(stakeholder).deposit(stakeholderVRoseAmount, repAttest.reputation, repAttest.expiry, repAttest.signature);
  });

  it("Should create a task with mandatory IPFS hash", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

    const expiry = await getFutureExpiry();
    const sig = await generatePassportSignature(customer.address, "createTask", expiry);

    await expect(
      roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry, sig)
    )
      .to.emit(roseMarketplace, "TaskCreated")
      .withArgs(1, customer.address, taskDeposit);

    const task = await roseMarketplace.tasks(1);
    expect(task.title).to.equal(taskTitle);
    expect(task.detailedDescriptionHash).to.equal(ipfsHash);
  });

  it("Should revert if detailed description hash is empty", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

    const expiry = await getFutureExpiry();
    const sig = await generatePassportSignature(customer.address, "createTask", expiry);

    await expect(
      roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, "", expiry, sig)
    ).to.be.revertedWith("Detailed description hash is required");
  });

  it("Should revert if title is empty", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

    const expiry = await getFutureExpiry();
    const sig = await generatePassportSignature(customer.address, "createTask", expiry);

    await expect(
      roseMarketplace.connect(customer).createTask("", taskDeposit, ipfsHash, expiry, sig)
    ).to.be.revertedWith("Title cannot be empty");
  });

  it("Should return true for isTaskParticipant when customer", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    const expiry = await getFutureExpiry();
    const sig = await generatePassportSignature(customer.address, "createTask", expiry);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry, sig);

    expect(await roseMarketplace.connect(customer).isTaskParticipant(1)).to.equal(true);
  });

  it("Should return true for isTaskParticipant when stakeholder", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    const createExpiry = await getFutureExpiry();
    const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

    // Stakeholder stakes with vROSE (approve marketplace to pull vROSE for escrow)
    const stakeholderDeposit = taskDeposit / 10n;
    await vRose.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    const stakeExpiry = await getFutureExpiry();
    const stakeSig = await generatePassportSignature(stakeholder.address, "stake", stakeExpiry);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit, stakeExpiry, stakeSig);

    expect(await roseMarketplace.connect(stakeholder).isTaskParticipant(1)).to.equal(true);
  });

  it("Should return true for isTaskParticipant when worker", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    const createExpiry = await getFutureExpiry();
    const createSig = await generatePassportSignature(customer.address, "createTask", createExpiry);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, createExpiry, createSig);

    // Stakeholder stakes with vROSE (approve marketplace to pull vROSE for escrow)
    const stakeholderDeposit = taskDeposit / 10n;
    await vRose.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    const stakeExpiry = await getFutureExpiry();
    const stakeSig = await generatePassportSignature(stakeholder.address, "stake", stakeExpiry);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit, stakeExpiry, stakeSig);

    const claimExpiry = await getFutureExpiry();
    const claimSig = await generatePassportSignature(worker.address, "claim", claimExpiry);
    await roseMarketplace.connect(worker).claimTask(1, claimExpiry, claimSig);

    expect(await roseMarketplace.connect(worker).isTaskParticipant(1)).to.equal(true);
  });

  it("Should return false for isTaskParticipant when not a participant", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    const expiry = await getFutureExpiry();
    const sig = await generatePassportSignature(customer.address, "createTask", expiry);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash, expiry, sig);

    expect(await roseMarketplace.connect(otherUser).isTaskParticipant(1)).to.equal(false);
  });
});
