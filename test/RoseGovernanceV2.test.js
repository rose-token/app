const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");

/**
 * RoseGovernance Two-Track System Tests
 *
 * Two tracks:
 * - Fast Track: 3 days, 10% quorum, merkle proof voting, abundant VP (full VP on multiple proposals)
 * - Slow Track: 14 days, 25% quorum, attestation voting, scarce VP (budget across proposals)
 *
 * Test Categories:
 * 1. Basic Staking
 * 2. Proposal Creation (including track forcing)
 * 3. Fast Track Voting (merkle proofs)
 * 4. Slow Track Voting (attestations, nonces)
 * 5. Quorum and Finalization
 * 6. Delegate Opt-In
 * 7. Execution and Rewards
 * 8. Admin Functions
 */
describe("RoseGovernance - Two-Track System", function () {
  let roseToken;
  let vRose;
  let governance;
  let reputation;
  let mockMarketplace;
  let mockTreasury;
  let owner;
  let passportSigner;
  let delegationSigner;
  let user1;
  let user2;
  let user3;
  let proposer;

  // Track enum values
  const Track = { Fast: 0, Slow: 1 };

  // ProposalStatus enum values
  const ProposalStatus = {
    Pending: 0,
    Active: 1,
    Passed: 2,
    Failed: 3,
    Executed: 4,
    Cancelled: 5,
  };

  // Time constants
  const SNAPSHOT_DELAY = 1 * 60 * 60; // 1 hr
  const FAST_DURATION = 3 * 24 * 60 * 60; // 3 days
  const SLOW_DURATION = 14 * 24 * 60 * 60; // 14 days

  // Quorum basis points
  const FAST_QUORUM_BPS = 1000; // 10%
  const SLOW_QUORUM_BPS = 2500; // 25%
  const BASIS_POINTS = 10000;

  // ============ Signature Helpers ============

  /**
   * Create passport signature for proposal creation
   */
  async function createProposalSignature(signer, address, expiry) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "string", "uint256"],
      [address, "propose", expiry]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  /**
   * Create reputation attestation signature
   */
  async function createReputationSignature(signer, user, reputation, expiry) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["string", "address", "uint256", "uint256"],
      ["reputation", user, reputation, expiry]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  /**
   * Create signature for setting VP merkle root
   */
  async function createMerkleRootSignature(
    signer,
    proposalId,
    merkleRoot,
    totalVP,
    expiry
  ) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["string", "uint256", "bytes32", "uint256", "uint256"],
      ["setVPMerkleRoot", proposalId, merkleRoot, totalVP, expiry]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  /**
   * Create Fast Track vote signature
   */
  async function createFastVoteSignature(
    signer,
    voter,
    proposalId,
    support,
    vpAmount,
    expiry
  ) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["string", "address", "uint256", "bool", "uint256", "uint256"],
      ["voteFast", voter, proposalId, support, vpAmount, expiry]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  /**
   * Create Slow Track vote signature (attestation)
   */
  async function createSlowVoteSignature(
    signer,
    voter,
    proposalId,
    support,
    vpAmount,
    availableVP,
    nonce,
    expiry
  ) {
    const messageHash = ethers.solidityPackedKeccak256(
      [
        "string",
        "address",
        "uint256",
        "bool",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
      ],
      ["voteSlow", voter, proposalId, support, vpAmount, availableVP, nonce, expiry]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  /**
   * Create voter rewards claim signature
   */
  async function createClaimSignature(signer, claimer, proposalIds, expiry) {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256[]"],
      [proposalIds]
    );
    const messageHash = ethers.solidityPackedKeccak256(
      ["string", "address", "bytes", "uint256"],
      ["claimVoterRewards", claimer, encoded, expiry]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  /**
   * Create signature for finalizing Slow Track proposal with snapshot
   */
  async function createSlowFinalizeSignature(
    signer,
    proposalId,
    merkleRoot,
    totalVP,
    expiry
  ) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["string", "uint256", "bytes32", "uint256", "uint256"],
      ["finalizeSlowProposal", proposalId, merkleRoot, totalVP, expiry]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  // ============ Reputation Helpers ============

  /**
   * Get reputation attestation params
   */
  async function getRepAttestation(user, rep = 60) {
    const currentBlock = await ethers.provider.getBlock("latest");
    const expiry = currentBlock.timestamp + 3600;
    const signature = await createReputationSignature(
      passportSigner,
      user.address,
      rep,
      expiry
    );
    return { reputation: rep, expiry, signature };
  }

  /**
   * Set up user with tasks to meet eligibility requirements
   * @param user - User to set up
   * @param taskCount - Number of tasks to complete (default: 10 for cold start)
   * @param failCount - Number of failed tasks (default: 0 for 100% reputation)
   */
  async function setupEligibleUser(user, taskCount = 10, failCount = 0) {
    // Complete successful tasks first
    for (let i = 0; i < taskCount - failCount; i++) {
      await mockMarketplace.updateUserStats(
        user.address,
        ethers.parseEther("100"),
        false
      );
    }
    // Then add failed tasks
    for (let i = 0; i < failCount; i++) {
      await mockMarketplace.updateUserStats(
        user.address,
        ethers.parseEther("100"),
        true
      );
    }
  }

  // Convenience aliases
  const setupEligibleProposer = (user) => setupEligibleUser(user, 10, 0);
  const setupEligibleVoter = (user) => setupEligibleUser(user, 10, 0);

  // ============ Merkle Tree Helpers ============

  /**
   * Build merkle tree for VP snapshot
   * OZ StandardMerkleTree uses double-hash (leaf = keccak256(keccak256(data)))
   */
  function buildVPMerkleTree(voters) {
    // voters = [{ address, vpAmount }]
    const values = voters.map((v) => [v.address, v.vpAmount.toString()]);
    return StandardMerkleTree.of(values, ["address", "uint256"]);
  }

  /**
   * Get merkle proof for a voter
   */
  function getMerkleProof(tree, voterAddress) {
    for (const [i, v] of tree.entries()) {
      if (v[0].toLowerCase() === voterAddress.toLowerCase()) {
        return tree.getProof(i);
      }
    }
    throw new Error("Voter not found in tree");
  }

  // ============ Proposal Helpers ============

  let proposalNonce = 0;

  /**
   * Create a proposal
   */
  async function createProposal(
    proposerAccount,
    track = Track.Slow,
    treasuryAmount = ethers.parseEther("100")
  ) {
    proposalNonce++;
    const currentBlock = await ethers.provider.getBlock("latest");
    const expiry = currentBlock.timestamp + 3600 + proposalNonce;
    const signature = await createProposalSignature(
      passportSigner,
      proposerAccount.address,
      expiry
    );
    const deadline = currentBlock.timestamp + 30 * 24 * 3600; // 30 days

    const rep = await getRepAttestation(proposerAccount, 90);

    await governance
      .connect(proposerAccount)
      .createProposal(
        track,
        "Test Proposal",
        "ipfs://QmTest",
        treasuryAmount,
        deadline,
        "Complete deliverables",
        expiry,
        signature,
        rep.reputation,
        rep.expiry,
        rep.signature
      );

    return await governance.proposalCounter();
  }

  // ============ Setup ============

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    [owner, passportSigner, delegationSigner, user1, user2, user3, proposer] =
      signers;

    // Deploy RoseToken
    const RoseToken = await ethers.getContractFactory("RoseToken");
    roseToken = await RoseToken.deploy(owner.address);

    // Deploy vROSE
    const VROSE = await ethers.getContractFactory("vROSE");
    vRose = await VROSE.deploy();

    // Deploy mock marketplace and treasury
    const MockMarketplace = await ethers.getContractFactory("MockMarketplace");
    mockMarketplace = await MockMarketplace.deploy();

    const MockTreasury = await ethers.getContractFactory("MockTreasury");
    mockTreasury = await MockTreasury.deploy();

    // Deploy RoseReputation
    const RoseReputation = await ethers.getContractFactory("RoseReputation");
    reputation = await RoseReputation.deploy(
      owner.address, // temporary governance
      await mockMarketplace.getAddress(),
      passportSigner.address
    );

    // Deploy Governance
    const Governance = await ethers.getContractFactory("RoseGovernance");
    governance = await Governance.deploy(
      await roseToken.getAddress(),
      await vRose.getAddress(),
      await mockMarketplace.getAddress(),
      await mockTreasury.getAddress(),
      passportSigner.address,
      await reputation.getAddress()
    );

    // Update reputation to point to actual governance
    await reputation.setGovernance(await governance.getAddress());

    // Set up permissions
    await vRose.setGovernance(await governance.getAddress());
    await mockMarketplace.setGovernance(await governance.getAddress());
    await mockMarketplace.setReputation(await reputation.getAddress());
    await governance.setDelegationSigner(delegationSigner.address);

    // Set snapshot delay to match test constant (1 hour instead of default 1 day)
    await governance.setSnapshotDelay(SNAPSHOT_DELAY);

    // Authorize token minting
    await roseToken.connect(owner).setAuthorized(owner.address, true);
    await roseToken
      .connect(owner)
      .setAuthorized(await governance.getAddress(), true);

    // Mint tokens to users
    await roseToken.connect(owner).mint(user1.address, ethers.parseEther("10000"));
    await roseToken.connect(owner).mint(user2.address, ethers.parseEther("10000"));
    await roseToken.connect(owner).mint(user3.address, ethers.parseEther("10000"));
    await roseToken
      .connect(owner)
      .mint(proposer.address, ethers.parseEther("10000"));

    // Mint to treasury for proposal value checks
    await roseToken
      .connect(owner)
      .mint(await mockTreasury.getAddress(), ethers.parseEther("1000000"));

    // Approve governance for token transfers
    await roseToken
      .connect(user1)
      .approve(await governance.getAddress(), ethers.MaxUint256);
    await roseToken
      .connect(user2)
      .approve(await governance.getAddress(), ethers.MaxUint256);
    await roseToken
      .connect(user3)
      .approve(await governance.getAddress(), ethers.MaxUint256);
    await roseToken
      .connect(proposer)
      .approve(await governance.getAddress(), ethers.MaxUint256);
  });

  // ============ Test Sections ============

  describe("Basic Staking", function () {
    it("Should deposit ROSE and mint vROSE 1:1", async function () {
      const depositAmount = ethers.parseEther("100");

      await governance.connect(user1).deposit(depositAmount);

      const stakedRose = await governance.stakedRose(user1.address);
      const vRoseBalance = await vRose.balanceOf(user1.address);

      expect(stakedRose).to.equal(depositAmount);
      expect(vRoseBalance).to.equal(depositAmount);
    });

    it("Should emit Deposited event on deposit", async function () {
      const depositAmount = ethers.parseEther("100");

      await expect(governance.connect(user1).deposit(depositAmount))
        .to.emit(governance, "Deposited")
        .withArgs(user1.address, depositAmount);
    });

    it("Should update totalStakedRose on deposit", async function () {
      const amount1 = ethers.parseEther("100");
      const amount2 = ethers.parseEther("200");

      await governance.connect(user1).deposit(amount1);
      await governance.connect(user2).deposit(amount2);

      const totalStaked = await governance.totalStakedRose();
      expect(totalStaked).to.equal(amount1 + amount2);
    });

    it("Should withdraw ROSE and burn vROSE", async function () {
      const depositAmount = ethers.parseEther("100");
      const withdrawAmount = ethers.parseEther("50");

      await governance.connect(user1).deposit(depositAmount);
      await governance.connect(user1).withdraw(withdrawAmount);

      const stakedRose = await governance.stakedRose(user1.address);
      const vRoseBalance = await vRose.balanceOf(user1.address);

      expect(stakedRose).to.equal(depositAmount - withdrawAmount);
      expect(vRoseBalance).to.equal(depositAmount - withdrawAmount);
    });

    it("Should emit Withdrawn event on withdrawal", async function () {
      const depositAmount = ethers.parseEther("100");
      const withdrawAmount = ethers.parseEther("50");

      await governance.connect(user1).deposit(depositAmount);

      await expect(governance.connect(user1).withdraw(withdrawAmount))
        .to.emit(governance, "Withdrawn")
        .withArgs(user1.address, withdrawAmount);
    });

    it("Should revert withdrawal if insufficient stake", async function () {
      const depositAmount = ethers.parseEther("100");

      await governance.connect(user1).deposit(depositAmount);

      await expect(
        governance.connect(user1).withdraw(ethers.parseEther("200"))
      ).to.be.revertedWithCustomError(governance, "InsufficientStake");
    });

    it("Should revert deposit of zero amount", async function () {
      await expect(
        governance.connect(user1).deposit(0)
      ).to.be.revertedWithCustomError(governance, "ZeroAmount");
    });
  });

  describe("Proposal Creation", function () {
    beforeEach(async function () {
      await setupEligibleProposer(proposer);
      await governance.connect(proposer).deposit(ethers.parseEther("1000"));
    });

    it("Should create Fast Track proposal with Pending status", async function () {
      const proposalId = await createProposal(proposer, Track.Fast);

      const proposal = await governance.proposals(proposalId);
      expect(proposal.track).to.equal(Track.Fast);
      expect(proposal.status).to.equal(ProposalStatus.Pending);
    });

    it("Should create Slow Track proposal with Active status", async function () {
      const proposalId = await createProposal(proposer, Track.Slow);

      const proposal = await governance.proposals(proposalId);
      expect(proposal.track).to.equal(Track.Slow);
      expect(proposal.status).to.equal(ProposalStatus.Active);
    });

    it("Should set correct voting times for Fast Track", async function () {
      const proposalId = await createProposal(proposer, Track.Fast);
      const proposal = await governance.proposals(proposalId);

      // Fast track: voting starts after snapshot delay
      const expectedStart = (await ethers.provider.getBlock("latest")).timestamp;
      expect(proposal.votingStartsAt).to.be.closeTo(
        BigInt(expectedStart) + BigInt(SNAPSHOT_DELAY),
        5n
      );
    });

    it("Should set correct voting times for Slow Track", async function () {
      const proposalId = await createProposal(proposer, Track.Slow);
      const proposal = await governance.proposals(proposalId);

      // Slow track: voting starts immediately
      const currentTime = (await ethers.provider.getBlock("latest")).timestamp;
      expect(proposal.votingStartsAt).to.be.closeTo(BigInt(currentTime), 5n);
    });

    it("Should emit ProposalCreated event", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createProposalSignature(
        passportSigner,
        proposer.address,
        expiry
      );
      const rep = await getRepAttestation(proposer, 90);

      await expect(
        governance.connect(proposer).createProposal(
          Track.Fast,
          "Test",
          "ipfs://test",
          ethers.parseEther("100"),
          currentBlock.timestamp + 30 * 24 * 3600,
          "Deliverables",
          expiry,
          signature,
          rep.reputation,
          rep.expiry,
          rep.signature
        )
      )
        .to.emit(governance, "ProposalCreated")
        .withArgs(1, proposer.address, Track.Fast, ethers.parseEther("100"));
    });

    it("Should revert Fast Track if treasury amount exceeds 1% limit", async function () {
      // Treasury has 1,000,000 ROSE, so 1% = 10,000 ROSE
      const largeAmount = ethers.parseEther("20000"); // 2% of treasury

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createProposalSignature(
        passportSigner,
        proposer.address,
        expiry
      );
      const rep = await getRepAttestation(proposer, 90);

      await expect(
        governance.connect(proposer).createProposal(
          Track.Fast,
          "Test",
          "ipfs://test",
          largeAmount,
          currentBlock.timestamp + 30 * 24 * 3600,
          "Deliverables",
          expiry,
          signature,
          rep.reputation,
          rep.expiry,
          rep.signature
        )
      ).to.be.revertedWithCustomError(governance, "FastTrackExceedsTreasuryLimit");
    });

    it("Should allow Slow Track with large treasury amount", async function () {
      const largeAmount = ethers.parseEther("50000"); // 5% of treasury

      const proposalId = await createProposal(proposer, Track.Slow, largeAmount);
      const proposal = await governance.proposals(proposalId);

      expect(proposal.treasuryAmount).to.equal(largeAmount);
      expect(proposal.track).to.equal(Track.Slow);
    });

    it("Should revert if proposer has insufficient reputation", async function () {
      // user1 has no tasks completed
      await governance.connect(user1).deposit(ethers.parseEther("1000"));

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createProposalSignature(
        passportSigner,
        user1.address,
        expiry
      );
      const rep = await getRepAttestation(user1, 60); // Below 90% threshold

      await expect(
        governance.connect(user1).createProposal(
          Track.Slow,
          "Test",
          "ipfs://test",
          ethers.parseEther("100"),
          currentBlock.timestamp + 30 * 24 * 3600,
          "Deliverables",
          expiry,
          signature,
          rep.reputation,
          rep.expiry,
          rep.signature
        )
      ).to.be.revertedWithCustomError(governance, "IneligibleToVote");
    });

    it("Should allow editing proposal", async function () {
      const proposalId = await createProposal(proposer, Track.Slow);

      await governance
        .connect(proposer)
        .editProposal(
          proposalId,
          "Updated Title",
          "ipfs://updated",
          ethers.parseEther("150"),
          (await ethers.provider.getBlock("latest")).timestamp + 60 * 24 * 3600,
          "Updated deliverables"
        );

      const proposal = await governance.proposals(proposalId);
      expect(proposal.title).to.equal("Updated Title");
      expect(proposal.treasuryAmount).to.equal(ethers.parseEther("150"));
      expect(proposal.editCount).to.equal(1);
    });

    it("Should allow cancelling proposal", async function () {
      const proposalId = await createProposal(proposer, Track.Slow);

      await governance.connect(proposer).cancelProposal(proposalId);

      const proposal = await governance.proposals(proposalId);
      expect(proposal.status).to.equal(ProposalStatus.Cancelled);
    });

    it("Should revert edit if not proposer", async function () {
      const proposalId = await createProposal(proposer, Track.Slow);

      await expect(
        governance
          .connect(user1)
          .editProposal(
            proposalId,
            "Hacked",
            "ipfs://hacked",
            ethers.parseEther("999999"),
            0,
            "Hacked"
          )
      ).to.be.revertedWithCustomError(governance, "OnlyProposerCanEdit");
    });

    it("Should revert after max 4 edits", async function () {
      const proposalId = await createProposal(proposer, Track.Slow);
      const currentBlock = await ethers.provider.getBlock("latest");
      const deadline = currentBlock.timestamp + 60 * 24 * 3600;

      // First 4 edits should succeed
      for (let i = 1; i <= 4; i++) {
        await governance
          .connect(proposer)
          .editProposal(
            proposalId,
            `Edit ${i}`,
            `ipfs://edit${i}`,
            ethers.parseEther("100"),
            deadline,
            "Deliverables"
          );

        const proposal = await governance.proposals(proposalId);
        expect(proposal.editCount).to.equal(i);
      }

      // 5th edit should fail
      await expect(
        governance
          .connect(proposer)
          .editProposal(
            proposalId,
            "Edit 5",
            "ipfs://edit5",
            ethers.parseEther("100"),
            deadline,
            "Deliverables"
          )
      ).to.be.revertedWithCustomError(governance, "MaxEditCyclesReached");
    });
  });

  describe("Fast Track Voting (Merkle Proofs)", function () {
    let proposalId;
    let merkleTree;
    let voters;

    beforeEach(async function () {
      // Setup eligible proposer and voters
      await setupEligibleProposer(proposer);
      await setupEligibleVoter(user1);
      await setupEligibleVoter(user2);

      // Deposit stakes
      await governance.connect(proposer).deposit(ethers.parseEther("1000"));
      await governance.connect(user1).deposit(ethers.parseEther("100"));
      await governance.connect(user2).deposit(ethers.parseEther("200"));

      // Create Fast Track proposal
      proposalId = await createProposal(proposer, Track.Fast);

      // Build merkle tree with voters
      // VP = sqrt(staked) * (rep / 100) in 9 decimals
      // user1: sqrt(100e18) * 0.7 ≈ 7e9 VP
      // user2: sqrt(200e18) * 0.7 ≈ 9.9e9 VP
      voters = [
        { address: user1.address, vpAmount: BigInt(7e9) },
        { address: user2.address, vpAmount: BigInt("9899494936") }, // sqrt(200e18) * 0.7
      ];
      merkleTree = buildVPMerkleTree(voters);

      // Calculate total VP
      const totalVP = voters.reduce((sum, v) => sum + v.vpAmount, 0n);

      // Advance time past snapshot delay
      await time.increase(SNAPSHOT_DELAY + 1);

      // Set merkle root (backend signature)
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createMerkleRootSignature(
        delegationSigner,
        proposalId,
        merkleTree.root,
        totalVP,
        expiry
      );

      await governance.setVPMerkleRoot(
        proposalId,
        merkleTree.root,
        totalVP,
        expiry,
        signature
      );
    });

    it("Should activate proposal after merkle root is set", async function () {
      const proposal = await governance.proposals(proposalId);
      expect(proposal.status).to.equal(ProposalStatus.Active);
      expect(proposal.vpMerkleRoot).to.equal(merkleTree.root);
    });

    it("Should emit ProposalActivated event", async function () {
      // Create another proposal to test event
      const newProposalId = await createProposal(proposer, Track.Fast);

      await time.increase(SNAPSHOT_DELAY + 1);

      const totalVP = voters.reduce((sum, v) => sum + v.vpAmount, 0n);
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createMerkleRootSignature(
        delegationSigner,
        newProposalId,
        merkleTree.root,
        totalVP,
        expiry
      );

      await expect(
        governance.setVPMerkleRoot(
          newProposalId,
          merkleTree.root,
          totalVP,
          expiry,
          signature
        )
      )
        .to.emit(governance, "ProposalActivated")
        .withArgs(newProposalId, merkleTree.root, totalVP);
    });

    it("Should allow voting with valid merkle proof", async function () {
      const voter = voters[0];
      const proof = getMerkleProof(merkleTree, voter.address);

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createFastVoteSignature(
        passportSigner,
        voter.address,
        proposalId,
        true,
        voter.vpAmount,
        expiry
      );
      const rep = await getRepAttestation(user1, 70);

      await expect(
        governance
          .connect(user1)
          .voteFast(
            proposalId,
            true,
            voter.vpAmount,
            proof,
            expiry,
            signature,
            rep.reputation,
            rep.expiry,
            rep.signature
          )
      )
        .to.emit(governance, "VoteCastFast")
        .withArgs(proposalId, user1.address, true, voter.vpAmount);
    });

    it("Should record vote correctly", async function () {
      const voter = voters[0];
      const proof = getMerkleProof(merkleTree, voter.address);

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createFastVoteSignature(
        passportSigner,
        voter.address,
        proposalId,
        true,
        voter.vpAmount,
        expiry
      );
      const rep = await getRepAttestation(user1, 70);

      await governance
        .connect(user1)
        .voteFast(
          proposalId,
          true,
          voter.vpAmount,
          proof,
          expiry,
          signature,
          rep.reputation,
          rep.expiry,
          rep.signature
        );

      const vote = await governance.votes(proposalId, user1.address);
      expect(vote.hasVoted).to.be.true;
      expect(vote.support).to.be.true;
      expect(vote.vpAmount).to.equal(voter.vpAmount);

      const proposal = await governance.proposals(proposalId);
      expect(proposal.forVotes).to.equal(voter.vpAmount);
    });

    it("Should reject invalid merkle proof", async function () {
      const voter = voters[0];
      const invalidProof = [ethers.keccak256(ethers.toUtf8Bytes("invalid"))];

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createFastVoteSignature(
        passportSigner,
        voter.address,
        proposalId,
        true,
        voter.vpAmount,
        expiry
      );
      const rep = await getRepAttestation(user1, 70);

      await expect(
        governance
          .connect(user1)
          .voteFast(
            proposalId,
            true,
            voter.vpAmount,
            invalidProof,
            expiry,
            signature,
            rep.reputation,
            rep.expiry,
            rep.signature
          )
      ).to.be.revertedWithCustomError(governance, "InvalidMerkleProof");
    });

    it("Should reject proof with wrong VP amount", async function () {
      const voter = voters[0];
      const proof = getMerkleProof(merkleTree, voter.address);
      const wrongVpAmount = voter.vpAmount + 1n; // Wrong amount

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createFastVoteSignature(
        passportSigner,
        voter.address,
        proposalId,
        true,
        wrongVpAmount,
        expiry
      );
      const rep = await getRepAttestation(user1, 70);

      await expect(
        governance
          .connect(user1)
          .voteFast(
            proposalId,
            true,
            wrongVpAmount,
            proof,
            expiry,
            signature,
            rep.reputation,
            rep.expiry,
            rep.signature
          )
      ).to.be.revertedWithCustomError(governance, "InvalidMerkleProof");
    });

    it("Should prevent double voting on same proposal", async function () {
      const voter = voters[0];
      const proof = getMerkleProof(merkleTree, voter.address);

      // First vote
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry1 = currentBlock.timestamp + 3600;
      const signature1 = await createFastVoteSignature(
        passportSigner,
        voter.address,
        proposalId,
        true,
        voter.vpAmount,
        expiry1
      );
      const rep1 = await getRepAttestation(user1, 70);

      await governance
        .connect(user1)
        .voteFast(
          proposalId,
          true,
          voter.vpAmount,
          proof,
          expiry1,
          signature1,
          rep1.reputation,
          rep1.expiry,
          rep1.signature
        );

      // Second vote attempt
      const expiry2 = expiry1 + 1;
      const signature2 = await createFastVoteSignature(
        passportSigner,
        voter.address,
        proposalId,
        true,
        voter.vpAmount,
        expiry2
      );
      const rep2 = await getRepAttestation(user1, 70);

      await expect(
        governance
          .connect(user1)
          .voteFast(
            proposalId,
            true,
            voter.vpAmount,
            proof,
            expiry2,
            signature2,
            rep2.reputation,
            rep2.expiry,
            rep2.signature
          )
      ).to.be.revertedWithCustomError(governance, "AlreadyVoted");
    });

    it("Should allow voting on multiple Fast Track proposals (abundant VP)", async function () {
      // Create second Fast Track proposal
      const proposalId2 = await createProposal(proposer, Track.Fast);

      await time.increase(SNAPSHOT_DELAY + 1);

      // Set merkle root for second proposal
      const totalVP = voters.reduce((sum, v) => sum + v.vpAmount, 0n);
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createMerkleRootSignature(
        delegationSigner,
        proposalId2,
        merkleTree.root,
        totalVP,
        expiry
      );
      await governance.setVPMerkleRoot(
        proposalId2,
        merkleTree.root,
        totalVP,
        expiry,
        signature
      );

      const voter = voters[0];

      // Vote on first proposal
      const proof1 = getMerkleProof(merkleTree, voter.address);
      const expiry1 = (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const sig1 = await createFastVoteSignature(
        passportSigner,
        voter.address,
        proposalId,
        true,
        voter.vpAmount,
        expiry1
      );
      const rep1 = await getRepAttestation(user1, 70);

      await governance
        .connect(user1)
        .voteFast(
          proposalId,
          true,
          voter.vpAmount,
          proof1,
          expiry1,
          sig1,
          rep1.reputation,
          rep1.expiry,
          rep1.signature
        );

      // Vote on second proposal with FULL VP (abundant VP - can use same VP)
      const proof2 = getMerkleProof(merkleTree, voter.address);
      const expiry2 = expiry1 + 1;
      const sig2 = await createFastVoteSignature(
        passportSigner,
        voter.address,
        proposalId2,
        true,
        voter.vpAmount,
        expiry2
      );
      const rep2 = await getRepAttestation(user1, 70);

      await expect(
        governance
          .connect(user1)
          .voteFast(
            proposalId2,
            true,
            voter.vpAmount,
            proof2,
            expiry2,
            sig2,
            rep2.reputation,
            rep2.expiry,
            rep2.signature
          )
      ).to.emit(governance, "VoteCastFast");

      // Verify both votes recorded with full VP
      const vote1 = await governance.votes(proposalId, user1.address);
      const vote2 = await governance.votes(proposalId2, user1.address);
      expect(vote1.vpAmount).to.equal(voter.vpAmount);
      expect(vote2.vpAmount).to.equal(voter.vpAmount);

      // Verify proposal forVotes totals are updated correctly
      const proposal1 = await governance.proposals(proposalId);
      const proposal2 = await governance.proposals(proposalId2);
      expect(proposal1.forVotes).to.equal(voter.vpAmount);
      expect(proposal2.forVotes).to.equal(voter.vpAmount);
    });

    it("Should reject expired signature", async function () {
      const voter = voters[0];
      const proof = getMerkleProof(merkleTree, voter.address);

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiredExpiry = currentBlock.timestamp - 1; // Already expired
      const signature = await createFastVoteSignature(
        passportSigner,
        voter.address,
        proposalId,
        true,
        voter.vpAmount,
        expiredExpiry
      );
      const rep = await getRepAttestation(user1, 70);

      await expect(
        governance
          .connect(user1)
          .voteFast(
            proposalId,
            true,
            voter.vpAmount,
            proof,
            expiredExpiry,
            signature,
            rep.reputation,
            rep.expiry,
            rep.signature
          )
      ).to.be.revertedWithCustomError(governance, "SignatureExpired");
    });

    it("Should reject voting on own proposal", async function () {
      // Add proposer to merkle tree
      const proposerVP = BigInt(10e9);
      const proposerVoters = [
        ...voters,
        { address: proposer.address, vpAmount: proposerVP },
      ];
      const proposerTree = buildVPMerkleTree(proposerVoters);
      const proof = getMerkleProof(proposerTree, proposer.address);

      // Create new proposal with proposer merkle tree
      const newProposalId = await createProposal(proposer, Track.Fast);
      await time.increase(SNAPSHOT_DELAY + 1);

      const totalVP = proposerVoters.reduce((sum, v) => sum + v.vpAmount, 0n);
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const rootSig = await createMerkleRootSignature(
        delegationSigner,
        newProposalId,
        proposerTree.root,
        totalVP,
        expiry
      );
      await governance.setVPMerkleRoot(
        newProposalId,
        proposerTree.root,
        totalVP,
        expiry,
        rootSig
      );

      // Try to vote on own proposal
      const voteSig = await createFastVoteSignature(
        passportSigner,
        proposer.address,
        newProposalId,
        true,
        proposerVP,
        expiry + 1
      );
      const rep = await getRepAttestation(proposer, 90);

      await expect(
        governance
          .connect(proposer)
          .voteFast(
            newProposalId,
            true,
            proposerVP,
            proof,
            expiry + 1,
            voteSig,
            rep.reputation,
            rep.expiry,
            rep.signature
          )
      ).to.be.revertedWithCustomError(governance, "CannotVoteOnOwnProposal");
    });

    it("Should reject voting if insufficient reputation", async function () {
      const voter = voters[0];
      const proof = getMerkleProof(merkleTree, voter.address);

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createFastVoteSignature(
        passportSigner,
        voter.address,
        proposalId,
        true,
        voter.vpAmount,
        expiry
      );
      const rep = await getRepAttestation(user1, 50); // Below 70% threshold

      await expect(
        governance
          .connect(user1)
          .voteFast(
            proposalId,
            true,
            voter.vpAmount,
            proof,
            expiry,
            signature,
            rep.reputation,
            rep.expiry,
            rep.signature
          )
      ).to.be.revertedWithCustomError(governance, "IneligibleToVote");
    });
  });

  describe("Slow Track Voting (Attestations)", function () {
    let proposalId;
    let proposalId2;
    const user1VP = BigInt(7e9); // Available VP for user1
    const user2VP = BigInt(10e9); // Available VP for user2

    beforeEach(async function () {
      await setupEligibleProposer(proposer);
      await setupEligibleVoter(user1);
      await setupEligibleVoter(user2);

      await governance.connect(proposer).deposit(ethers.parseEther("1000"));
      await governance.connect(user1).deposit(ethers.parseEther("100"));
      await governance.connect(user2).deposit(ethers.parseEther("200"));

      // Create Slow Track proposals
      proposalId = await createProposal(proposer, Track.Slow);
      proposalId2 = await createProposal(proposer, Track.Slow);

      // Set total VP for slow track (backend would do this)
      // For testing, we use the totalStakedRose as totalVP at finalization
    });

    it("Should allow voting with valid attestation", async function () {
      const nonce = await governance.allocationNonce(user1.address);
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;

      const signature = await createSlowVoteSignature(
        delegationSigner,
        user1.address,
        proposalId,
        true,
        user1VP,
        user1VP, // availableVP
        nonce,
        expiry
      );
      const rep = await getRepAttestation(user1, 70);

      await expect(
        governance
          .connect(user1)
          .voteSlow(
            proposalId,
            true,
            user1VP,
            user1VP,
            nonce,
            expiry,
            signature,
            rep.reputation,
            rep.expiry,
            rep.signature
          )
      )
        .to.emit(governance, "VoteCastSlow")
        .withArgs(proposalId, user1.address, true, user1VP, nonce);
    });

    it("Should increment nonce after voting", async function () {
      const nonceBefore = await governance.allocationNonce(user1.address);

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createSlowVoteSignature(
        delegationSigner,
        user1.address,
        proposalId,
        true,
        user1VP,
        user1VP,
        nonceBefore,
        expiry
      );
      const rep = await getRepAttestation(user1, 70);

      await governance
        .connect(user1)
        .voteSlow(
          proposalId,
          true,
          user1VP,
          user1VP,
          nonceBefore,
          expiry,
          signature,
          rep.reputation,
          rep.expiry,
          rep.signature
        );

      const nonceAfter = await governance.allocationNonce(user1.address);
      expect(nonceAfter).to.equal(nonceBefore + 1n);
    });

    it("Should reject stale nonce", async function () {
      // First vote to increment nonce
      const nonce0 = await governance.allocationNonce(user1.address);
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;

      const sig1 = await createSlowVoteSignature(
        delegationSigner,
        user1.address,
        proposalId,
        true,
        user1VP / 2n,
        user1VP,
        nonce0,
        expiry
      );
      const rep1 = await getRepAttestation(user1, 70);

      await governance
        .connect(user1)
        .voteSlow(
          proposalId,
          true,
          user1VP / 2n,
          user1VP,
          nonce0,
          expiry,
          sig1,
          rep1.reputation,
          rep1.expiry,
          rep1.signature
        );

      // Try to use the same (now stale) nonce
      const sig2 = await createSlowVoteSignature(
        delegationSigner,
        user1.address,
        proposalId2,
        true,
        user1VP / 2n,
        user1VP / 2n, // Reduced available VP
        nonce0, // STALE nonce
        expiry + 1
      );
      const rep2 = await getRepAttestation(user1, 70);

      await expect(
        governance
          .connect(user1)
          .voteSlow(
            proposalId2,
            true,
            user1VP / 2n,
            user1VP / 2n,
            nonce0,
            expiry + 1,
            sig2,
            rep2.reputation,
            rep2.expiry,
            rep2.signature
          )
      ).to.be.revertedWithCustomError(governance, "StaleNonce");
    });

    it("Should reject expired attestation", async function () {
      const nonce = await governance.allocationNonce(user1.address);
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiredExpiry = currentBlock.timestamp - 1; // Already expired

      const signature = await createSlowVoteSignature(
        delegationSigner,
        user1.address,
        proposalId,
        true,
        user1VP,
        user1VP,
        nonce,
        expiredExpiry
      );
      const rep = await getRepAttestation(user1, 70);

      await expect(
        governance
          .connect(user1)
          .voteSlow(
            proposalId,
            true,
            user1VP,
            user1VP,
            nonce,
            expiredExpiry,
            signature,
            rep.reputation,
            rep.expiry,
            rep.signature
          )
      ).to.be.revertedWithCustomError(governance, "SignatureExpired");
    });

    it("Should reject if voting more than available VP", async function () {
      const nonce = await governance.allocationNonce(user1.address);
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;

      const signature = await createSlowVoteSignature(
        delegationSigner,
        user1.address,
        proposalId,
        true,
        user1VP + 1n, // More than available
        user1VP,
        nonce,
        expiry
      );
      const rep = await getRepAttestation(user1, 70);

      await expect(
        governance
          .connect(user1)
          .voteSlow(
            proposalId,
            true,
            user1VP + 1n,
            user1VP,
            nonce,
            expiry,
            signature,
            rep.reputation,
            rep.expiry,
            rep.signature
          )
      ).to.be.revertedWithCustomError(governance, "InsufficientAvailableVP");
    });

    it("Should allow vote updates (change VP amount)", async function () {
      // First vote
      const nonce1 = await governance.allocationNonce(user1.address);
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;

      const sig1 = await createSlowVoteSignature(
        delegationSigner,
        user1.address,
        proposalId,
        true,
        user1VP / 2n,
        user1VP,
        nonce1,
        expiry
      );
      const rep1 = await getRepAttestation(user1, 70);

      await governance
        .connect(user1)
        .voteSlow(
          proposalId,
          true,
          user1VP / 2n,
          user1VP,
          nonce1,
          expiry,
          sig1,
          rep1.reputation,
          rep1.expiry,
          rep1.signature
        );

      // Update vote with different amount
      const nonce2 = await governance.allocationNonce(user1.address);
      const sig2 = await createSlowVoteSignature(
        delegationSigner,
        user1.address,
        proposalId,
        true,
        user1VP, // Increased amount
        user1VP,
        nonce2,
        expiry + 1
      );
      const rep2 = await getRepAttestation(user1, 70);

      await expect(
        governance
          .connect(user1)
          .voteSlow(
            proposalId,
            true,
            user1VP,
            user1VP,
            nonce2,
            expiry + 1,
            sig2,
            rep2.reputation,
            rep2.expiry,
            rep2.signature
          )
      )
        .to.emit(governance, "VoteUpdated")
        .withArgs(proposalId, user1.address, user1VP / 2n, user1VP);
    });

    it("Should track VP budget across slow track proposals (scarce VP)", async function () {
      // Vote on first proposal with half VP
      const nonce1 = await governance.allocationNonce(user1.address);
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;

      const sig1 = await createSlowVoteSignature(
        delegationSigner,
        user1.address,
        proposalId,
        true,
        user1VP / 2n,
        user1VP, // Full VP available at start
        nonce1,
        expiry
      );
      const rep1 = await getRepAttestation(user1, 70);

      await governance
        .connect(user1)
        .voteSlow(
          proposalId,
          true,
          user1VP / 2n,
          user1VP,
          nonce1,
          expiry,
          sig1,
          rep1.reputation,
          rep1.expiry,
          rep1.signature
        );

      // Vote on second proposal - backend would attest reduced available VP
      const nonce2 = await governance.allocationNonce(user1.address);
      const remainingVP = user1VP / 2n; // Half VP remaining after first vote

      const sig2 = await createSlowVoteSignature(
        delegationSigner,
        user1.address,
        proposalId2,
        true,
        remainingVP,
        remainingVP, // Backend attests only remaining VP
        nonce2,
        expiry + 1
      );
      const rep2 = await getRepAttestation(user1, 70);

      await governance
        .connect(user1)
        .voteSlow(
          proposalId2,
          true,
          remainingVP,
          remainingVP,
          nonce2,
          expiry + 1,
          sig2,
          rep2.reputation,
          rep2.expiry,
          rep2.signature
        );

      // Verify votes on both proposals
      const vote1 = await governance.votes(proposalId, user1.address);
      const vote2 = await governance.votes(proposalId2, user1.address);
      expect(vote1.vpAmount).to.equal(user1VP / 2n);
      expect(vote2.vpAmount).to.equal(remainingVP);
    });

    it("Should reject reused signature", async function () {
      const nonce = await governance.allocationNonce(user1.address);
      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;

      const signature = await createSlowVoteSignature(
        delegationSigner,
        user1.address,
        proposalId,
        true,
        user1VP,
        user1VP,
        nonce,
        expiry
      );
      const rep = await getRepAttestation(user1, 70);

      // First use
      await governance
        .connect(user1)
        .voteSlow(
          proposalId,
          true,
          user1VP,
          user1VP,
          nonce,
          expiry,
          signature,
          rep.reputation,
          rep.expiry,
          rep.signature
        );

      // Try to reuse same signature (would need same nonce which is now stale)
      // This is actually caught by StaleNonce, but signature replay protection also exists
      const rep2 = await getRepAttestation(user1, 70);
      await expect(
        governance
          .connect(user1)
          .voteSlow(
            proposalId,
            true,
            user1VP,
            user1VP,
            nonce,
            expiry,
            signature,
            rep2.reputation,
            rep2.expiry,
            rep2.signature
          )
      ).to.be.revertedWithCustomError(governance, "StaleNonce");
    });
  });

  describe("Quorum and Finalization", function () {
    let fastProposalId;
    let slowProposalId;
    let merkleTree;
    let voters;

    beforeEach(async function () {
      await setupEligibleProposer(proposer);
      await setupEligibleVoter(user1);
      await setupEligibleVoter(user2);

      await governance.connect(proposer).deposit(ethers.parseEther("1000"));
      await governance.connect(user1).deposit(ethers.parseEther("1000"));
      await governance.connect(user2).deposit(ethers.parseEther("1000"));

      // Create proposals
      fastProposalId = await createProposal(proposer, Track.Fast);
      slowProposalId = await createProposal(proposer, Track.Slow);

      // Set up merkle tree for fast track
      voters = [
        { address: user1.address, vpAmount: BigInt(100e9) },
        { address: user2.address, vpAmount: BigInt(100e9) },
      ];
      merkleTree = buildVPMerkleTree(voters);
      const totalVP = BigInt(200e9);

      await time.increase(SNAPSHOT_DELAY + 1);

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createMerkleRootSignature(
        delegationSigner,
        fastProposalId,
        merkleTree.root,
        totalVP,
        expiry
      );
      await governance.setVPMerkleRoot(
        fastProposalId,
        merkleTree.root,
        totalVP,
        expiry,
        signature
      );
    });

    it("Should calculate Fast Track quorum at 10%", async function () {
      const [current, required] = await governance.getQuorumProgress(fastProposalId);
      const totalVP = await governance.proposalTotalVP(fastProposalId);

      // 10% of 200e9 = 20e9
      expect(required).to.equal((totalVP * BigInt(FAST_QUORUM_BPS)) / BigInt(BASIS_POINTS));
      expect(current).to.equal(0n);
    });

    it("Should pass proposal when quorum met and >58.33% for votes", async function () {
      // Vote to meet quorum (10% of 200e9 = 20e9)
      // Vote with full VP for votes
      const voter = voters[0];
      const proof = getMerkleProof(merkleTree, voter.address);

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createFastVoteSignature(
        passportSigner,
        voter.address,
        fastProposalId,
        true,
        voter.vpAmount,
        expiry
      );
      const rep = await getRepAttestation(user1, 70);

      await governance
        .connect(user1)
        .voteFast(
          fastProposalId,
          true,
          voter.vpAmount,
          proof,
          expiry,
          signature,
          rep.reputation,
          rep.expiry,
          rep.signature
        );

      // Advance time past voting period
      await time.increase(FAST_DURATION + 1);

      // Finalize
      await governance.finalizeProposal(fastProposalId);

      const proposal = await governance.proposals(fastProposalId);
      expect(proposal.status).to.equal(ProposalStatus.Passed);
    });

    it("Should fail proposal when quorum met but <58.33% for votes", async function () {
      // Both users vote - user1 for, user2 against (50/50 split)
      const voter1 = voters[0];
      const proof1 = getMerkleProof(merkleTree, voter1.address);
      let currentBlock = await ethers.provider.getBlock("latest");
      let expiry = currentBlock.timestamp + 3600;

      const sig1 = await createFastVoteSignature(
        passportSigner,
        voter1.address,
        fastProposalId,
        true,
        voter1.vpAmount,
        expiry
      );
      const rep1 = await getRepAttestation(user1, 70);

      await governance
        .connect(user1)
        .voteFast(
          fastProposalId,
          true,
          voter1.vpAmount,
          proof1,
          expiry,
          sig1,
          rep1.reputation,
          rep1.expiry,
          rep1.signature
        );

      const voter2 = voters[1];
      const proof2 = getMerkleProof(merkleTree, voter2.address);
      const sig2 = await createFastVoteSignature(
        passportSigner,
        voter2.address,
        fastProposalId,
        false, // Against
        voter2.vpAmount,
        expiry + 1
      );
      const rep2 = await getRepAttestation(user2, 70);

      await governance
        .connect(user2)
        .voteFast(
          fastProposalId,
          false,
          voter2.vpAmount,
          proof2,
          expiry + 1,
          sig2,
          rep2.reputation,
          rep2.expiry,
          rep2.signature
        );

      await time.increase(FAST_DURATION + 1);
      await governance.finalizeProposal(fastProposalId);

      const proposal = await governance.proposals(fastProposalId);
      expect(proposal.status).to.equal(ProposalStatus.Failed);
    });

    it("Should extend voting if quorum not met", async function () {
      // Don't vote - quorum won't be met
      await time.increase(FAST_DURATION + 1);

      const proposalBefore = await governance.proposals(fastProposalId);
      const endsBefore = proposalBefore.votingEndsAt;

      await governance.finalizeProposal(fastProposalId);

      const proposalAfter = await governance.proposals(fastProposalId);
      expect(proposalAfter.status).to.equal(ProposalStatus.Active); // Still active
      expect(proposalAfter.votingEndsAt).to.be.gt(endsBefore); // Extended

      const extensions = await governance.proposalExtensions(fastProposalId);
      expect(extensions).to.equal(1);
    });

    it("Should fail after max quorum extensions (3)", async function () {
      // 3 extensions without meeting quorum
      for (let i = 0; i < 3; i++) {
        await time.increase(FAST_DURATION + 1);
        await governance.finalizeProposal(fastProposalId);
      }

      const extensions = await governance.proposalExtensions(fastProposalId);
      expect(extensions).to.equal(3);

      // 4th attempt should fail the proposal
      await time.increase(FAST_DURATION + 1);
      await governance.finalizeProposal(fastProposalId);

      const proposal = await governance.proposals(fastProposalId);
      expect(proposal.status).to.equal(ProposalStatus.Failed);
    });

    it("Should record failed proposal on reputation", async function () {
      const statsBefore = await reputation.userStats(proposer.address);
      const failedBefore = statsBefore.failedProposals;

      // Fail the proposal
      for (let i = 0; i < 4; i++) {
        await time.increase(FAST_DURATION + 1);
        await governance.finalizeProposal(fastProposalId);
      }

      const statsAfter = await reputation.userStats(proposer.address);
      expect(statsAfter.failedProposals).to.equal(failedBefore + 1n);
    });

    it("Should revert finalize before voting ends", async function () {
      await expect(
        governance.finalizeProposal(fastProposalId)
      ).to.be.revertedWithCustomError(governance, "ProposalNotEnded");
    });

    it("Slow Track should reject finalizeProposal() and require finalizeSlowProposal()", async function () {
      await time.increase(SLOW_DURATION + 1);

      // Regular finalizeProposal should revert for Slow Track
      await expect(
        governance.finalizeProposal(slowProposalId)
      ).to.be.revertedWithCustomError(governance, "ProposalNotActive");
    });

    it("Slow Track should finalize with merkle snapshot via finalizeSlowProposal()", async function () {
      await time.increase(SLOW_DURATION + 1);

      // Build merkle tree for finalization snapshot
      const snapshotVoters = [
        { address: user1.address, vpAmount: BigInt(100e9) },
        { address: user2.address, vpAmount: BigInt(100e9) },
      ];
      const snapshotTree = buildVPMerkleTree(snapshotVoters);
      const snapshotTotalVP = BigInt(200e9);

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createSlowFinalizeSignature(
        delegationSigner,
        slowProposalId,
        snapshotTree.root,
        snapshotTotalVP,
        expiry
      );

      // Finalize with snapshot
      await governance.finalizeSlowProposal(
        slowProposalId,
        snapshotTree.root,
        snapshotTotalVP,
        expiry,
        signature
      );

      // Check merkle root and totalVP were set
      const proposal = await governance.proposals(slowProposalId);
      expect(proposal.vpMerkleRoot).to.equal(snapshotTree.root);

      const totalVP = await governance.proposalTotalVP(slowProposalId);
      expect(totalVP).to.equal(snapshotTotalVP);
    });

    it("Slow Track should use 25% quorum from submitted totalVP", async function () {
      // First, cast some votes on slow track to meet quorum
      const nonce = await governance.allocationNonce(user1.address);
      const user1VP = BigInt(60e9); // 60 VP

      let currentBlock = await ethers.provider.getBlock("latest");
      let expiry = currentBlock.timestamp + 3600;

      const voteSig = await createSlowVoteSignature(
        delegationSigner,
        user1.address,
        slowProposalId,
        true,
        user1VP,
        user1VP,
        nonce,
        expiry
      );
      const rep = await getRepAttestation(user1, 70);

      await governance
        .connect(user1)
        .voteSlow(
          slowProposalId,
          true,
          user1VP,
          user1VP,
          nonce,
          expiry,
          voteSig,
          rep.reputation,
          rep.expiry,
          rep.signature
        );

      await time.increase(SLOW_DURATION + 1);

      // Build merkle tree where totalVP = 200e9, so 25% quorum = 50e9
      // user1 voted 60e9, which exceeds 50e9 quorum
      const snapshotVoters = [
        { address: user1.address, vpAmount: BigInt(100e9) },
        { address: user2.address, vpAmount: BigInt(100e9) },
      ];
      const snapshotTree = buildVPMerkleTree(snapshotVoters);
      const snapshotTotalVP = BigInt(200e9);

      currentBlock = await ethers.provider.getBlock("latest");
      expiry = currentBlock.timestamp + 3600;
      const finalizeSig = await createSlowFinalizeSignature(
        delegationSigner,
        slowProposalId,
        snapshotTree.root,
        snapshotTotalVP,
        expiry
      );

      await governance.finalizeSlowProposal(
        slowProposalId,
        snapshotTree.root,
        snapshotTotalVP,
        expiry,
        finalizeSig
      );

      // Should pass (60 votes > 50 quorum, 100% for)
      const proposal = await governance.proposals(slowProposalId);
      expect(proposal.status).to.equal(ProposalStatus.Passed);
    });

    it("Should reject finalizeSlowProposal with invalid signature", async function () {
      await time.increase(SLOW_DURATION + 1);

      const snapshotVoters = [
        { address: user1.address, vpAmount: BigInt(100e9) },
      ];
      const snapshotTree = buildVPMerkleTree(snapshotVoters);
      const snapshotTotalVP = BigInt(100e9);

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;

      // Sign with wrong signer
      const badSignature = await createSlowFinalizeSignature(
        user1, // Wrong signer
        slowProposalId,
        snapshotTree.root,
        snapshotTotalVP,
        expiry
      );

      await expect(
        governance.finalizeSlowProposal(
          slowProposalId,
          snapshotTree.root,
          snapshotTotalVP,
          expiry,
          badSignature
        )
      ).to.be.revertedWithCustomError(governance, "InvalidSignature");
    });

    it("Should reject finalizeSlowProposal with expired signature", async function () {
      await time.increase(SLOW_DURATION + 1);

      const snapshotVoters = [
        { address: user1.address, vpAmount: BigInt(100e9) },
      ];
      const snapshotTree = buildVPMerkleTree(snapshotVoters);
      const snapshotTotalVP = BigInt(100e9);

      // Expired timestamp
      const expiredTimestamp = 1;
      const signature = await createSlowFinalizeSignature(
        delegationSigner,
        slowProposalId,
        snapshotTree.root,
        snapshotTotalVP,
        expiredTimestamp
      );

      await expect(
        governance.finalizeSlowProposal(
          slowProposalId,
          snapshotTree.root,
          snapshotTotalVP,
          expiredTimestamp,
          signature
        )
      ).to.be.revertedWithCustomError(governance, "SignatureExpired");
    });

    it("Should reject finalizeSlowProposal for Fast Track proposals", async function () {
      await time.increase(FAST_DURATION + 1);

      const snapshotVoters = [
        { address: user1.address, vpAmount: BigInt(100e9) },
      ];
      const snapshotTree = buildVPMerkleTree(snapshotVoters);
      const snapshotTotalVP = BigInt(100e9);

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createSlowFinalizeSignature(
        delegationSigner,
        fastProposalId, // Fast Track proposal
        snapshotTree.root,
        snapshotTotalVP,
        expiry
      );

      await expect(
        governance.finalizeSlowProposal(
          fastProposalId,
          snapshotTree.root,
          snapshotTotalVP,
          expiry,
          signature
        )
      ).to.be.revertedWithCustomError(governance, "ProposalNotActive");
    });
  });

  describe("Delegate Opt-In", function () {
    beforeEach(async function () {
      await governance.connect(user1).deposit(ethers.parseEther("100"));
    });

    it("Should allow opting in as delegate", async function () {
      await governance.connect(user1).setDelegateOptIn(true);

      const isOptedIn = await governance.isDelegateOptedIn(user1.address);
      expect(isOptedIn).to.be.true;
    });

    it("Should emit DelegateOptInChanged event", async function () {
      await expect(governance.connect(user1).setDelegateOptIn(true))
        .to.emit(governance, "DelegateOptInChanged")
        .withArgs(user1.address, true);
    });

    it("Should allow opting out as delegate", async function () {
      await governance.connect(user1).setDelegateOptIn(true);
      await governance.connect(user1).setDelegateOptIn(false);

      const isOptedIn = await governance.isDelegateOptedIn(user1.address);
      expect(isOptedIn).to.be.false;
    });

    it("canReceiveDelegation should return true when opted in and has stake", async function () {
      await governance.connect(user1).setDelegateOptIn(true);

      const canReceive = await governance.canReceiveDelegation(user1.address);
      expect(canReceive).to.be.true;
    });

    it("canReceiveDelegation should return false when not opted in", async function () {
      const canReceive = await governance.canReceiveDelegation(user1.address);
      expect(canReceive).to.be.false;
    });

    it("canReceiveDelegation should return false when no stake", async function () {
      await governance.connect(user2).setDelegateOptIn(true);

      const canReceive = await governance.canReceiveDelegation(user2.address);
      expect(canReceive).to.be.false;
    });
  });

  describe("Execution and Rewards", function () {
    let proposalId;

    beforeEach(async function () {
      await setupEligibleProposer(proposer);
      await setupEligibleVoter(user1);

      await governance.connect(proposer).deposit(ethers.parseEther("1000"));
      await governance.connect(user1).deposit(ethers.parseEther("1000"));

      // Create and activate fast track proposal
      proposalId = await createProposal(proposer, Track.Fast);

      const voters = [{ address: user1.address, vpAmount: BigInt(100e9) }];
      const merkleTree = buildVPMerkleTree(voters);
      const totalVP = BigInt(100e9);

      await time.increase(SNAPSHOT_DELAY + 1);

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createMerkleRootSignature(
        delegationSigner,
        proposalId,
        merkleTree.root,
        totalVP,
        expiry
      );
      await governance.setVPMerkleRoot(
        proposalId,
        merkleTree.root,
        totalVP,
        expiry,
        signature
      );

      // Vote for the proposal
      const proof = getMerkleProof(merkleTree, user1.address);
      const voteSig = await createFastVoteSignature(
        passportSigner,
        user1.address,
        proposalId,
        true,
        BigInt(100e9),
        expiry + 1
      );
      const rep = await getRepAttestation(user1, 70);

      await governance
        .connect(user1)
        .voteFast(
          proposalId,
          true,
          BigInt(100e9),
          proof,
          expiry + 1,
          voteSig,
          rep.reputation,
          rep.expiry,
          rep.signature
        );

      // Finalize to pass
      await time.increase(FAST_DURATION + 1);
      await governance.finalizeProposal(proposalId);
    });

    it("Should execute passed proposal and create marketplace task", async function () {
      await expect(governance.executeProposal(proposalId))
        .to.emit(governance, "ProposalExecuted");

      const proposal = await governance.proposals(proposalId);
      expect(proposal.status).to.equal(ProposalStatus.Executed);
      expect(proposal.taskId).to.be.gt(0);
    });

    it("Should revert execute if proposal not passed", async function () {
      // Create another proposal that hasn't passed
      const newProposalId = await createProposal(proposer, Track.Slow);

      await expect(
        governance.executeProposal(newProposalId)
      ).to.be.revertedWithCustomError(governance, "ProposalNotPassed");
    });

    it("Should distribute rewards on task completion", async function () {
      await governance.executeProposal(proposalId);
      const proposal = await governance.proposals(proposalId);

      // Complete task through marketplace
      await expect(mockMarketplace.completeTask(proposal.taskId))
        .to.emit(governance, "RewardsDistributed");

      // Check reward pool was created
      const rewardPool = await governance.voterRewardPool(proposalId);
      expect(rewardPool).to.be.gt(0);
    });

    it("Should not distribute rewards for failed proposals", async function () {
      // Create a new proposal that will fail
      const failedProposalId = await createProposal(proposer, Track.Fast);

      // Set up merkle tree for the new proposal
      const failedVoters = [{ address: user1.address, vpAmount: BigInt(100e9) }];
      const failedTree = buildVPMerkleTree(failedVoters);
      const failedTotalVP = BigInt(100e9);

      await time.increase(SNAPSHOT_DELAY + 1);

      const currentBlock = await ethers.provider.getBlock("latest");
      const expiry = currentBlock.timestamp + 3600;
      const signature = await createMerkleRootSignature(
        delegationSigner,
        failedProposalId,
        failedTree.root,
        failedTotalVP,
        expiry
      );
      await governance.setVPMerkleRoot(
        failedProposalId,
        failedTree.root,
        failedTotalVP,
        expiry,
        signature
      );

      // Vote against the proposal
      const proof = getMerkleProof(failedTree, user1.address);
      const voteSig = await createFastVoteSignature(
        passportSigner,
        user1.address,
        failedProposalId,
        false, // Vote against
        BigInt(100e9),
        expiry + 1
      );
      const rep = await getRepAttestation(user1, 70);

      await governance
        .connect(user1)
        .voteFast(
          failedProposalId,
          false, // Against
          BigInt(100e9),
          proof,
          expiry + 1,
          voteSig,
          rep.reputation,
          rep.expiry,
          rep.signature
        );

      // Finalize - should fail because 100% against
      await time.increase(FAST_DURATION + 1);
      await governance.finalizeProposal(failedProposalId);

      const proposal = await governance.proposals(failedProposalId);
      expect(proposal.status).to.equal(ProposalStatus.Failed);

      // Failed proposals cannot be executed, therefore no rewards can ever be distributed
      // (rewards are only distributed via onTaskComplete which requires execution)
      await expect(
        governance.executeProposal(failedProposalId)
      ).to.be.revertedWithCustomError(governance, "ProposalNotPassed");

      // Verify no task was created (taskId remains 0)
      expect(proposal.taskId).to.equal(0);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set snapshot delay", async function () {
      const newDelay = 2 * 24 * 60 * 60; // 2 days

      await expect(governance.connect(owner).setSnapshotDelay(newDelay))
        .to.emit(governance, "ConfigUpdated")
        .withArgs("snapshotDelay", newDelay);

      expect(await governance.snapshotDelay()).to.equal(newDelay);
    });

    it("Should allow owner to set fast duration", async function () {
      const newDuration = 5 * 24 * 60 * 60; // 5 days

      await governance.connect(owner).setFastDuration(newDuration);

      expect(await governance.fastDuration()).to.equal(newDuration);
    });

    it("Should allow owner to set slow duration", async function () {
      const newDuration = 21 * 24 * 60 * 60; // 21 days

      await governance.connect(owner).setSlowDuration(newDuration);

      expect(await governance.slowDuration()).to.equal(newDuration);
    });

    it("Should allow owner to set fast quorum", async function () {
      const newQuorum = 1500; // 15%

      await governance.connect(owner).setFastQuorumBps(newQuorum);

      expect(await governance.fastQuorumBps()).to.equal(newQuorum);
    });

    it("Should allow owner to set slow quorum", async function () {
      const newQuorum = 3000; // 30%

      await governance.connect(owner).setSlowQuorumBps(newQuorum);

      expect(await governance.slowQuorumBps()).to.equal(newQuorum);
    });

    it("Should allow owner to set fast track limit", async function () {
      const newLimit = 200; // 2%

      await governance.connect(owner).setFastTrackLimitBps(newLimit);

      expect(await governance.fastTrackLimitBps()).to.equal(newLimit);
    });

    it("Should revert admin calls from non-owner", async function () {
      await expect(
        governance.connect(user1).setSnapshotDelay(1000)
      ).to.be.revertedWithCustomError(governance, "NotOwner");
    });

    it("Should allow owner to transfer ownership", async function () {
      await governance.connect(owner).transferOwnership(user1.address);

      // New owner should be able to call admin functions
      await expect(
        governance.connect(user1).setSnapshotDelay(1000)
      ).to.not.be.reverted;

      // Old owner should not
      await expect(
        governance.connect(owner).setSnapshotDelay(2000)
      ).to.be.revertedWithCustomError(governance, "NotOwner");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await setupEligibleProposer(proposer);
      await governance.connect(proposer).deposit(ethers.parseEther("1000"));
    });

    it("getVotePower should calculate VP correctly", async function () {
      // VP = sqrt(amount) * (rep / 100)
      const amount = ethers.parseEther("100"); // 100e18
      const rep = 80;

      const vp = await governance.getVotePower(amount, rep);

      // sqrt(100e18) ≈ 10e9, * 0.8 = 8e9
      const expected = BigInt(8e9);
      expect(vp).to.be.closeTo(expected, expected / 10n); // Allow 10% tolerance
    });

    it("getQuorumProgress should return current and required", async function () {
      const proposalId = await createProposal(proposer, Track.Slow);

      const [current, required] = await governance.getQuorumProgress(proposalId);

      expect(current).to.equal(0n);
      // Slow track requires 25% quorum
      // Since totalVP is 0 initially for slow track, required will be 0
      // After finalization, it uses totalStakedRose
    });

    it("getVoteResult should return for and against percentages", async function () {
      const proposalId = await createProposal(proposer, Track.Slow);

      const [forPercent, againstPercent] = await governance.getVoteResult(proposalId);

      // No votes yet
      expect(forPercent).to.equal(0n);
      expect(againstPercent).to.equal(0n);
    });
  });
});
