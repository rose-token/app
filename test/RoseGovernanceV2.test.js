const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * RoseGovernance V2 Tests - VP-Centric Model
 *
 * Key changes from V1:
 * - VP calculated at deposit time: sqrt(stakedRose) * (reputation/100)
 * - Multi-delegation: delegate(address, uint256 vpAmount), undelegate(address, uint256 vpAmount)
 * - VP locked to ONE proposal at a time
 * - vote() requires passport signature
 * - freeVP() to unlock after proposal resolves
 */
describe("RoseGovernance V2 - VP Centric Model", function () {
  let roseToken;
  let vRose;
  let governance;
  let mockMarketplace;
  let mockTreasury;
  let owner;
  let passportSigner;
  let delegationSigner;
  let user1;
  let user2;
  let user3;
  let proposer;

  const VOTING_PERIOD = 14 * 24 * 60 * 60; // 2 weeks in seconds

  // Helper to create passport signature for voting
  async function createVoteSignature(signer, voter, proposalId, vpAmount, support, expiry) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["string", "address", "uint256", "uint256", "bool", "uint256"],
      ["vote", voter, proposalId, vpAmount, support, expiry]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  // Helper to create passport signature for proposal
  async function createProposalSignature(signer, address, action, expiry) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "string", "uint256"],
      [address, action, expiry]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  // Helper to create delegation vote signature
  async function createDelegatedVoteSignature(signer, delegate, proposalId, vpAmount, support, allocationsHash, expiry) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["string", "address", "uint256", "uint256", "bool", "bytes32", "uint256"],
      ["delegatedVote", delegate, proposalId, vpAmount, support, allocationsHash, expiry]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  // Helper to compute allocations hash
  function computeAllocationsHash(proposalId, delegate, allocations) {
    const abiCoder = new ethers.AbiCoder();
    const sorted = [...allocations].sort((a, b) =>
      a.delegator.toLowerCase().localeCompare(b.delegator.toLowerCase())
    );
    return ethers.keccak256(
      abiCoder.encode(
        ["uint256", "address", "tuple(address,uint256)[]"],
        [proposalId, delegate, sorted.map(a => [a.delegator, a.powerUsed])]
      )
    );
  }

  // Helper to set up an eligible proposer (10+ tasks, 90%+ reputation)
  async function setupEligibleProposer(user) {
    // Call through mockMarketplace which will call governance.updateUserStats
    for (let i = 0; i < 10; i++) {
      await mockMarketplace.updateUserStats(
        user.address,
        ethers.parseEther("100"),
        false
      );
    }
  }

  // Helper to set up an eligible voter (70%+ reputation)
  async function setupEligibleVoter(user) {
    // Call through mockMarketplace which will call governance.updateUserStats
    for (let i = 0; i < 10; i++) {
      await mockMarketplace.updateUserStats(
        user.address,
        ethers.parseEther("100"),
        false
      );
    }
  }

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    [owner, passportSigner, delegationSigner, user1, user2, user3, proposer] = signers;

    // Deploy RoseToken
    const RoseToken = await ethers.getContractFactory("RoseToken");
    roseToken = await RoseToken.deploy(owner.address);

    // Deploy vROSE
    const VROSE = await ethers.getContractFactory("vROSE");
    vRose = await VROSE.deploy();

    // Deploy mock marketplace and treasury (for testing)
    const MockMarketplace = await ethers.getContractFactory("MockMarketplace");
    mockMarketplace = await MockMarketplace.deploy();

    const MockTreasury = await ethers.getContractFactory("MockTreasury");
    mockTreasury = await MockTreasury.deploy();

    // Deploy Governance
    const Governance = await ethers.getContractFactory("RoseGovernance");
    governance = await Governance.deploy(
      await roseToken.getAddress(),
      await vRose.getAddress(),
      await mockMarketplace.getAddress(),
      await mockTreasury.getAddress(),
      passportSigner.address
    );

    // Set up permissions
    await vRose.setGovernance(await governance.getAddress());
    await mockMarketplace.setGovernance(await governance.getAddress());
    await governance.setDelegationSigner(delegationSigner.address);

    // Mint tokens to users for testing
    await roseToken.connect(owner).setAuthorized(owner.address, true);
    await roseToken.connect(owner).mint(user1.address, ethers.parseEther("10000"));
    await roseToken.connect(owner).mint(user2.address, ethers.parseEther("10000"));
    await roseToken.connect(owner).mint(user3.address, ethers.parseEther("10000"));
    await roseToken.connect(owner).mint(proposer.address, ethers.parseEther("10000"));

    // Approve governance for token transfers
    await roseToken.connect(user1).approve(await governance.getAddress(), ethers.MaxUint256);
    await roseToken.connect(user2).approve(await governance.getAddress(), ethers.MaxUint256);
    await roseToken.connect(user3).approve(await governance.getAddress(), ethers.MaxUint256);
    await roseToken.connect(proposer).approve(await governance.getAddress(), ethers.MaxUint256);
  });

  describe("VP Calculation at Deposit", function () {
    it("Should calculate and store VP at deposit time", async function () {
      const depositAmount = ethers.parseEther("100");

      // Default reputation is 60%
      await governance.connect(user1).deposit(depositAmount);

      const stakedRose = await governance.stakedRose(user1.address);
      const votingPower = await governance.votingPower(user1.address);

      expect(stakedRose).to.equal(depositAmount);

      // VP = sqrt(stakedRose) * (reputation / 100)
      // VP = sqrt(100e18) * (60 / 100) = 10e9 * 0.6 = 6e9
      const expectedVP = BigInt(Math.floor(Math.sqrt(Number(depositAmount)) * 0.6));
      expect(votingPower).to.be.closeTo(expectedVP, expectedVP / 100n); // Allow 1% tolerance
    });

    it("Should emit VotingPowerChanged event on deposit", async function () {
      const depositAmount = ethers.parseEther("100");

      await expect(governance.connect(user1).deposit(depositAmount))
        .to.emit(governance, "VotingPowerChanged");
    });

    it("Should update totalVotingPower on deposit", async function () {
      const depositAmount = ethers.parseEther("100");

      await governance.connect(user1).deposit(depositAmount);
      const totalVP1 = await governance.totalVotingPower();

      await governance.connect(user2).deposit(depositAmount);
      const totalVP2 = await governance.totalVotingPower();

      expect(totalVP2).to.be.gt(totalVP1);
    });

    it("Should mint vROSE 1:1 on deposit", async function () {
      const depositAmount = ethers.parseEther("100");

      await governance.connect(user1).deposit(depositAmount);

      const vRoseBalance = await vRose.balanceOf(user1.address);
      expect(vRoseBalance).to.equal(depositAmount);
    });
  });

  describe("VP-Based Withdrawal", function () {
    beforeEach(async function () {
      await governance.connect(user1).deposit(ethers.parseEther("100"));
    });

    it("Should allow withdrawal when VP is not locked", async function () {
      const withdrawAmount = ethers.parseEther("50");

      // No approval needed - governance burns vROSE directly
      await expect(governance.connect(user1).withdraw(withdrawAmount))
        .to.emit(governance, "Withdrawn")
        .withArgs(user1.address, withdrawAmount);

      const remainingStaked = await governance.stakedRose(user1.address);
      expect(remainingStaked).to.equal(ethers.parseEther("50"));
    });

    it("Should update VP on withdrawal", async function () {
      const withdrawAmount = ethers.parseEther("50");

      const vpBefore = await governance.votingPower(user1.address);

      await governance.connect(user1).withdraw(withdrawAmount);

      const vpAfter = await governance.votingPower(user1.address);
      expect(vpAfter).to.be.lt(vpBefore);
    });

    it("Should emit VotingPowerChanged on withdrawal", async function () {
      const withdrawAmount = ethers.parseEther("50");

      await expect(governance.connect(user1).withdraw(withdrawAmount))
        .to.emit(governance, "VotingPowerChanged");
    });
  });

  describe("Multi-Delegation", function () {
    // VP calculation: sqrt(100e18) * (100/100) = 10e9 VP for 100 ROSE with 100% rep
    // We'll use small amounts relative to this scale
    const SMALL_VP = BigInt(1e9); // 1 VP (in raw units)
    const MEDIUM_VP = BigInt(2e9); // 2 VP

    beforeEach(async function () {
      // Set up eligible delegate and voter
      await setupEligibleProposer(user2); // User2 is eligible delegate
      await setupEligibleVoter(user1);    // User1 can vote

      // User1 deposits
      await governance.connect(user1).deposit(ethers.parseEther("100"));
      // User2 deposits (to be delegate)
      await governance.connect(user2).deposit(ethers.parseEther("100"));
    });

    it("Should allow delegating VP to eligible delegate", async function () {
      await expect(governance.connect(user1).delegate(user2.address, SMALL_VP))
        .to.emit(governance, "DelegationChanged")
        .withArgs(user1.address, user2.address, SMALL_VP, true);
    });

    it("Should track delegation amounts correctly", async function () {
      await governance.connect(user1).delegate(user2.address, SMALL_VP);

      const delegatedVP = await governance.delegatedVP(user1.address, user2.address);
      const totalDelegatedOut = await governance.totalDelegatedOut(user1.address);
      const totalDelegatedIn = await governance.totalDelegatedIn(user2.address);

      expect(delegatedVP).to.equal(SMALL_VP);
      expect(totalDelegatedOut).to.equal(SMALL_VP);
      expect(totalDelegatedIn).to.equal(SMALL_VP);
    });

    it("Should reduce available VP after delegation", async function () {
      const vpBefore = await governance.getAvailableVP(user1.address);

      await governance.connect(user1).delegate(user2.address, SMALL_VP);

      const vpAfter = await governance.getAvailableVP(user1.address);
      expect(vpAfter).to.equal(vpBefore - SMALL_VP);
    });

    it("Should allow delegating to multiple delegates", async function () {
      await setupEligibleProposer(user3); // User3 is also eligible
      await governance.connect(user3).deposit(ethers.parseEther("100"));

      await governance.connect(user1).delegate(user2.address, SMALL_VP);
      await governance.connect(user1).delegate(user3.address, MEDIUM_VP);

      const delegatedToUser2 = await governance.delegatedVP(user1.address, user2.address);
      const delegatedToUser3 = await governance.delegatedVP(user1.address, user3.address);
      const totalDelegatedOut = await governance.totalDelegatedOut(user1.address);

      expect(delegatedToUser2).to.equal(SMALL_VP);
      expect(delegatedToUser3).to.equal(MEDIUM_VP);
      expect(totalDelegatedOut).to.equal(SMALL_VP + MEDIUM_VP);
    });

    it("Should allow partial undelegation", async function () {
      await governance.connect(user1).delegate(user2.address, MEDIUM_VP);
      await governance.connect(user1).undelegate(user2.address, SMALL_VP);

      const remaining = await governance.delegatedVP(user1.address, user2.address);
      expect(remaining).to.equal(MEDIUM_VP - SMALL_VP);
    });

    it("Should revert if delegating to self", async function () {
      await expect(
        governance.connect(user1).delegate(user1.address, SMALL_VP)
      ).to.be.revertedWithCustomError(governance, "CannotDelegateToSelf");
    });

    it("Should revert if delegating to ineligible delegate", async function () {
      // User3 is not eligible (cold start)
      await expect(
        governance.connect(user1).delegate(user3.address, SMALL_VP)
      ).to.be.revertedWithCustomError(governance, "IneligibleToDelegate");
    });

    it("Should revert if insufficient available VP", async function () {
      const vpAmount = await governance.votingPower(user1.address);

      await expect(
        governance.connect(user1).delegate(user2.address, vpAmount + 1n)
      ).to.be.revertedWithCustomError(governance, "InsufficientAvailableVP");
    });
  });

  describe("VP-Based Voting", function () {
    let proposalId;
    // VP amounts must be in raw units. For 100 ROSE with 100% rep, VP ≈ 10e9
    const VP_AMOUNT = BigInt(1e9); // 1 VP
    const VP_AMOUNT_SMALL = BigInt(5e8); // 0.5 VP
    let proposalNonce = 0;

    // Helper to create proposal (with unique expiry each time)
    async function createProposal(proposerAccount) {
      proposalNonce++;
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600 + proposalNonce; // Unique expiry
      const signature = await createProposalSignature(passportSigner, proposerAccount.address, "propose", expiry);
      const deadline = currentBlock.timestamp + 30 * 24 * 3600; // 30 days

      // Need actual ROSE in treasury for proposal value check
      await roseToken.connect(owner).mint(await mockTreasury.getAddress(), ethers.parseEther("10000"));

      await governance.connect(proposerAccount).propose(
        "Test Proposal",
        "ipfs://QmTest",
        ethers.parseEther("100"),
        deadline,
        "Complete deliverables",
        expiry,
        signature
      );
    }

    beforeEach(async function () {
      // Set up eligible proposer and voter
      await setupEligibleProposer(proposer);
      await setupEligibleVoter(user1);

      // Deposit to get VP
      await governance.connect(proposer).deposit(ethers.parseEther("1000"));
      await governance.connect(user1).deposit(ethers.parseEther("100"));

      // Create proposal
      await createProposal(proposer);
      proposalId = 1;
    });

    it("Should allow voting with VP and signature", async function () {
      const support = true;
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const signature = await createVoteSignature(passportSigner, user1.address, proposalId, VP_AMOUNT, support, expiry);

      await expect(governance.connect(user1).vote(proposalId, VP_AMOUNT, support, expiry, signature))
        .to.emit(governance, "VPAllocatedToProposal");
    });

    it("Should lock VP to proposal", async function () {
      const support = true;
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const signature = await createVoteSignature(passportSigner, user1.address, proposalId, VP_AMOUNT, support, expiry);

      await governance.connect(user1).vote(proposalId, VP_AMOUNT, support, expiry, signature);

      const allocatedProposal = await governance.allocatedToProposal(user1.address);
      const lockedVP = await governance.proposalVPLocked(user1.address);

      expect(allocatedProposal).to.equal(proposalId);
      expect(lockedVP).to.equal(VP_AMOUNT);
    });

    it("Should reduce available VP after voting", async function () {
      const support = true;
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const signature = await createVoteSignature(passportSigner, user1.address, proposalId, VP_AMOUNT, support, expiry);

      const availableBefore = await governance.getAvailableVP(user1.address);

      await governance.connect(user1).vote(proposalId, VP_AMOUNT, support, expiry, signature);

      const availableAfter = await governance.getAvailableVP(user1.address);
      expect(availableAfter).to.equal(availableBefore - VP_AMOUNT);
    });

    it("Should allow increasing vote (same direction)", async function () {
      const support = true;

      const expiry1 = Math.floor(Date.now() / 1000) + 3600;
      const signature1 = await createVoteSignature(passportSigner, user1.address, proposalId, VP_AMOUNT_SMALL, support, expiry1);
      await governance.connect(user1).vote(proposalId, VP_AMOUNT_SMALL, support, expiry1, signature1);

      const expiry2 = Math.floor(Date.now() / 1000) + 3601;
      const signature2 = await createVoteSignature(passportSigner, user1.address, proposalId, VP_AMOUNT_SMALL, support, expiry2);
      await governance.connect(user1).vote(proposalId, VP_AMOUNT_SMALL, support, expiry2, signature2);

      const lockedVP = await governance.proposalVPLocked(user1.address);
      expect(lockedVP).to.equal(VP_AMOUNT_SMALL + VP_AMOUNT_SMALL);
    });

    it("Should revert if changing vote direction", async function () {
      const expiry1 = Math.floor(Date.now() / 1000) + 3600;
      const signature1 = await createVoteSignature(passportSigner, user1.address, proposalId, VP_AMOUNT_SMALL, true, expiry1);
      await governance.connect(user1).vote(proposalId, VP_AMOUNT_SMALL, true, expiry1, signature1);

      const expiry2 = Math.floor(Date.now() / 1000) + 3601;
      const signature2 = await createVoteSignature(passportSigner, user1.address, proposalId, VP_AMOUNT_SMALL, false, expiry2);

      await expect(
        governance.connect(user1).vote(proposalId, VP_AMOUNT_SMALL, false, expiry2, signature2)
      ).to.be.revertedWithCustomError(governance, "CannotChangeVoteDirection");
    });

    it("Should revert if VP locked to different proposal", async function () {
      // Create second proposal
      await createProposal(proposer);

      // Vote on first proposal
      const voteExpiry = Math.floor(Date.now() / 1000) + 3600;
      const voteSig = await createVoteSignature(passportSigner, user1.address, 1, VP_AMOUNT, true, voteExpiry);
      await governance.connect(user1).vote(1, VP_AMOUNT, true, voteExpiry, voteSig);

      // Try to vote on second proposal (should fail)
      const voteSig2 = await createVoteSignature(passportSigner, user1.address, 2, VP_AMOUNT, true, voteExpiry + 1);

      await expect(
        governance.connect(user1).vote(2, VP_AMOUNT, true, voteExpiry + 1, voteSig2)
      ).to.be.revertedWithCustomError(governance, "VPLockedToAnotherProposal");
    });

    it("Should allow proposer to vote on other proposals", async function () {
      // Create second proposal from user1
      await setupEligibleProposer(user1);
      await createProposal(user1);

      // User1 can vote on first proposal (not their own)
      const voteExpiry = Math.floor(Date.now() / 1000) + 3600;
      const voteSig = await createVoteSignature(passportSigner, user1.address, 1, VP_AMOUNT, true, voteExpiry);

      await expect(
        governance.connect(user1).vote(1, VP_AMOUNT, true, voteExpiry, voteSig)
      ).to.emit(governance, "VPAllocatedToProposal");
    });
  });

  describe("freeVP After Proposal Resolution", function () {
    let proposalId;
    let proposalNonce = 0;

    // Helper to create proposal (with unique expiry each time)
    async function createProposal(proposerAccount) {
      proposalNonce++;
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600 + proposalNonce;
      const signature = await createProposalSignature(passportSigner, proposerAccount.address, "propose", expiry);
      const deadline = currentBlock.timestamp + 30 * 24 * 3600;

      // Need actual ROSE in treasury for proposal value check
      await roseToken.connect(owner).mint(await mockTreasury.getAddress(), ethers.parseEther("10000"));

      await governance.connect(proposerAccount).propose(
        "Test Proposal",
        "ipfs://QmTest",
        ethers.parseEther("100"),
        deadline,
        "Complete deliverables",
        expiry,
        signature
      );
    }

    beforeEach(async function () {
      await setupEligibleProposer(proposer);
      await setupEligibleVoter(user1);
      await setupEligibleVoter(user2);

      await governance.connect(proposer).deposit(ethers.parseEther("1000"));
      await governance.connect(user1).deposit(ethers.parseEther("100"));
      await governance.connect(user2).deposit(ethers.parseEther("500")); // More stake to help meet quorum

      // Create proposal
      await createProposal(proposer);
      proposalId = 1;

      // Vote on proposal with enough VP to meet quorum (33% of total)
      // User1 votes with their full VP
      const user1VP = await governance.votingPower(user1.address);
      const currentBlock = await ethers.provider.getBlock("latest");
      const voteExpiry = currentBlock.timestamp + 3600;
      const voteSig = await createVoteSignature(passportSigner, user1.address, proposalId, user1VP, true, voteExpiry);
      await governance.connect(user1).vote(proposalId, user1VP, true, voteExpiry, voteSig);

      // User2 also votes to ensure quorum
      const user2VP = await governance.votingPower(user2.address);
      const currentBlock2 = await ethers.provider.getBlock("latest");
      const voteExpiry2 = currentBlock2.timestamp + 3600;
      const voteSig2 = await createVoteSignature(passportSigner, user2.address, proposalId, user2VP, true, voteExpiry2);
      await governance.connect(user2).vote(proposalId, user2VP, true, voteExpiry2, voteSig2);
    });

    it("Should revert freeVP if proposal still active", async function () {
      await expect(
        governance.connect(user1).freeVP(proposalId)
      ).to.be.revertedWithCustomError(governance, "ProposalNotEnded");
    });

    it("Should allow freeVP after proposal passes", async function () {
      // Fast forward past voting period
      await time.increase(VOTING_PERIOD + 1);

      // Finalize proposal
      await governance.finalizeProposal(proposalId);

      // Now user can free VP
      await expect(governance.connect(user1).freeVP(proposalId))
        .to.emit(governance, "VPFreedFromProposal");

      const allocatedProposal = await governance.allocatedToProposal(user1.address);
      const lockedVP = await governance.proposalVPLocked(user1.address);

      expect(allocatedProposal).to.equal(0);
      expect(lockedVP).to.equal(0);
    });

    it("Should restore available VP after freeVP", async function () {
      const availableBefore = await governance.getAvailableVP(user1.address);

      // Fast forward and finalize
      await time.increase(VOTING_PERIOD + 1);
      await governance.finalizeProposal(proposalId);

      await governance.connect(user1).freeVP(proposalId);

      const availableAfter = await governance.getAvailableVP(user1.address);
      expect(availableAfter).to.be.gt(availableBefore);
    });
  });

  describe("Withdrawal with Locked VP", function () {
    const VP_AMOUNT = BigInt(1e9); // 1 VP
    let proposalNonce = 0;

    // Helper to create proposal (with unique expiry each time)
    async function createProposal(proposerAccount) {
      proposalNonce++;
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600 + proposalNonce;
      const signature = await createProposalSignature(passportSigner, proposerAccount.address, "propose", expiry);
      const deadline = currentBlock.timestamp + 30 * 24 * 3600;

      // Need actual ROSE in treasury for proposal value check
      await roseToken.connect(owner).mint(await mockTreasury.getAddress(), ethers.parseEther("10000"));

      await governance.connect(proposerAccount).propose(
        "Test Proposal",
        "ipfs://QmTest",
        ethers.parseEther("100"),
        deadline,
        "Complete deliverables",
        expiry,
        signature
      );
    }

    beforeEach(async function () {
      await setupEligibleProposer(proposer);
      await setupEligibleVoter(user1);
      await setupEligibleProposer(user2);

      await governance.connect(proposer).deposit(ethers.parseEther("1000"));
      await governance.connect(user1).deposit(ethers.parseEther("100"));
      await governance.connect(user2).deposit(ethers.parseEther("100"));
    });

    it("Should revert withdrawal if VP is delegated", async function () {
      // Delegate most of the VP
      const userVP = await governance.votingPower(user1.address);
      await governance.connect(user1).delegate(user2.address, userVP - 1n);

      // Try to withdraw all - should fail since VP is locked in delegation
      await expect(
        governance.connect(user1).withdraw(ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(governance, "VPLocked");
    });

    it("Should revert withdrawal if VP is on proposal", async function () {
      // Create proposal and vote
      await createProposal(proposer);

      const currentBlock = await ethers.provider.getBlock("latest");
      const voteExpiry = currentBlock.timestamp + 3600;
      const voteSig = await createVoteSignature(passportSigner, user1.address, 1, VP_AMOUNT, true, voteExpiry);
      await governance.connect(user1).vote(1, VP_AMOUNT, true, voteExpiry, voteSig);

      // Try to withdraw all - should fail since VP is locked in proposal
      await expect(
        governance.connect(user1).withdraw(ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(governance, "VPLocked");
    });

    it("Should allow partial withdrawal when VP is available", async function () {
      // Don't delegate or vote - all VP is available
      const withdrawAmount = ethers.parseEther("10"); // Small amount

      // Should succeed since no VP is locked
      await expect(
        governance.connect(user1).withdraw(withdrawAmount)
      ).to.emit(governance, "Withdrawn");

      const remaining = await governance.stakedRose(user1.address);
      expect(remaining).to.equal(ethers.parseEther("90"));
    });
  });

  describe("Delegated Voting with Signature", function () {
    let proposalId;
    const VP_AMOUNT = BigInt(1e9); // 1 VP
    let proposalNonce = 0;

    // Helper to create proposal (with unique expiry each time)
    async function createProposal(proposerAccount) {
      proposalNonce++;
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600 + proposalNonce;
      const signature = await createProposalSignature(passportSigner, proposerAccount.address, "propose", expiry);
      const deadline = currentBlock.timestamp + 30 * 24 * 3600;

      // Need actual ROSE in treasury for proposal value check
      await roseToken.connect(owner).mint(await mockTreasury.getAddress(), ethers.parseEther("10000"));

      await governance.connect(proposerAccount).propose(
        "Test Proposal",
        "ipfs://QmTest",
        ethers.parseEther("100"),
        deadline,
        "Complete deliverables",
        expiry,
        signature
      );
    }

    beforeEach(async function () {
      await setupEligibleProposer(proposer);
      await setupEligibleProposer(user2); // Delegate
      await setupEligibleVoter(user1);

      await governance.connect(proposer).deposit(ethers.parseEther("1000"));
      await governance.connect(user1).deposit(ethers.parseEther("100"));
      await governance.connect(user2).deposit(ethers.parseEther("100"));

      // User1 delegates to user2
      await governance.connect(user1).delegate(user2.address, VP_AMOUNT);

      // Create proposal
      await createProposal(proposer);
      proposalId = 1;
    });

    it("Should allow delegate to cast vote with received VP", async function () {
      const support = true;
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;

      const allocations = [{ delegator: user1.address, powerUsed: VP_AMOUNT }];
      const allocationsHash = computeAllocationsHash(proposalId, user2.address, allocations);

      const signature = await createDelegatedVoteSignature(
        delegationSigner,
        user2.address,
        proposalId,
        VP_AMOUNT,
        support,
        allocationsHash,
        expiry
      );

      await expect(
        governance.connect(user2).castDelegatedVote(proposalId, VP_AMOUNT, support, allocationsHash, expiry, signature)
      ).to.emit(governance, "VPAllocatedToProposal");
    });

    it("Should update proposal votes with delegated VP", async function () {
      const support = true;
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;

      const allocations = [{ delegator: user1.address, powerUsed: VP_AMOUNT }];
      const allocationsHash = computeAllocationsHash(proposalId, user2.address, allocations);

      const signature = await createDelegatedVoteSignature(
        delegationSigner,
        user2.address,
        proposalId,
        VP_AMOUNT,
        support,
        allocationsHash,
        expiry
      );

      const proposalBefore = await governance.proposals(proposalId);
      const yayBefore = proposalBefore.yayVotes;

      await governance.connect(user2).castDelegatedVote(proposalId, VP_AMOUNT, support, allocationsHash, expiry, signature);

      const proposalAfter = await governance.proposals(proposalId);
      expect(proposalAfter.yayVotes).to.equal(yayBefore + VP_AMOUNT);
    });
  });

  describe("Total VP Tracking", function () {
    it("Should track total VP correctly across deposits", async function () {
      await governance.connect(user1).deposit(ethers.parseEther("100"));
      const total1 = await governance.totalVotingPower();

      await governance.connect(user2).deposit(ethers.parseEther("100"));
      const total2 = await governance.totalVotingPower();

      expect(total2).to.be.gt(total1);
    });

    it("Should reduce total VP on withdrawal", async function () {
      await governance.connect(user1).deposit(ethers.parseEther("100"));
      const totalBefore = await governance.totalVotingPower();

      await governance.connect(user1).withdraw(ethers.parseEther("50"));

      const totalAfter = await governance.totalVotingPower();
      expect(totalAfter).to.be.lt(totalBefore);
    });

    it("Should emit TotalVPUpdated on VP changes", async function () {
      await expect(governance.connect(user1).deposit(ethers.parseEther("100")))
        .to.emit(governance, "TotalVPUpdated");
    });
  });

  describe("View Functions", function () {
    const VP_AMOUNT = BigInt(1e9); // 1 VP

    beforeEach(async function () {
      await setupEligibleProposer(user2);
      await setupEligibleVoter(user1);

      await governance.connect(user1).deposit(ethers.parseEther("100"));
      await governance.connect(user2).deposit(ethers.parseEther("100"));
    });

    it("Should return correct available VP", async function () {
      const vpBefore = await governance.getAvailableVP(user1.address);
      expect(vpBefore).to.be.gt(0);

      // Delegate some
      await governance.connect(user1).delegate(user2.address, VP_AMOUNT);

      const vpAfter = await governance.getAvailableVP(user1.address);
      expect(vpAfter).to.be.lt(vpBefore);
    });

    it("Should return user delegations", async function () {
      await governance.connect(user1).delegate(user2.address, VP_AMOUNT);

      const [delegates, amounts] = await governance.getUserDelegations(user1.address);
      expect(delegates.length).to.equal(1);
      expect(delegates[0]).to.equal(user2.address);
      expect(amounts[0]).to.equal(VP_AMOUNT);
    });
  });
});

// Mock contracts for testing
describe("Mock Contracts", function () {
  it("MockMarketplace and MockTreasury are deployed as needed by tests above", async function () {
    // This just ensures the contract factories exist
    const MockMarketplace = await ethers.getContractFactory("MockMarketplace");
    const MockTreasury = await ethers.getContractFactory("MockTreasury");
    expect(MockMarketplace).to.not.be.undefined;
    expect(MockTreasury).to.not.be.undefined;
  });
});
