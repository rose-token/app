const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("RoseGovernance", function () {
  let roseToken;
  let vRose;
  let governance;
  let mockMarketplace;
  let mockTreasury;
  let owner;
  let passportSigner;
  let user1;
  let user2;
  let user3;
  let proposer;

  const VOTING_PERIOD = 14 * 24 * 60 * 60; // 2 weeks in seconds
  const QUORUM_THRESHOLD = 3300n; // 33%
  const PASS_THRESHOLD = 5833n; // 58.33%
  const BASIS_POINTS = 10000n;

  // Helper to create passport signature
  async function createSignature(signer, address, action, expiry) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "string", "uint256"],
      [address, action, expiry]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  // Helper to set up an eligible proposer (10+ tasks, 90%+ reputation)
  async function setupEligibleProposer(user) {
    // Set up as eligible via marketplace callback (10 tasks, no disputes)
    for (let i = 0; i < 10; i++) {
      await governance.connect(mockMarketplace.runner || mockMarketplace).updateUserStats(
        user.address,
        ethers.parseEther("100"),
        false
      );
    }
  }

  // Helper to set up an eligible voter (70%+ reputation)
  async function setupEligibleVoter(user) {
    // Default reputation is 60%, need 10 tasks to compute real reputation
    for (let i = 0; i < 10; i++) {
      await governance.connect(mockMarketplace.runner || mockMarketplace).updateUserStats(
        user.address,
        ethers.parseEther("100"),
        false
      );
    }
  }

  beforeEach(async function () {
    [owner, passportSigner, user1, user2, user3, proposer] = await ethers.getSigners();

    // Deploy RoseToken
    const RoseToken = await ethers.getContractFactory("RoseToken");
    roseToken = await RoseToken.deploy(owner.address);
    await roseToken.waitForDeployment();

    // Deploy vROSE
    const VROSE = await ethers.getContractFactory("vROSE");
    vRose = await VROSE.deploy();
    await vRose.waitForDeployment();

    // Use a simple address for mock marketplace and treasury initially
    // We'll set up governance first, then update marketplace address
    const tempMarketplace = user3.address;
    const tempTreasury = owner.address;

    // Deploy RoseGovernance
    const RoseGovernance = await ethers.getContractFactory("RoseGovernance");
    governance = await RoseGovernance.deploy(
      await roseToken.getAddress(),
      await vRose.getAddress(),
      tempMarketplace,
      tempTreasury,
      passportSigner.address
    );
    await governance.waitForDeployment();

    // Set vROSE governance to our governance contract
    await vRose.setGovernance(await governance.getAddress());

    // Authorize governance to mint ROSE (for rewards)
    await roseToken.setAuthorized(await governance.getAddress(), true);

    // Create a mock marketplace using user3 as the signer
    mockMarketplace = user3;
    mockTreasury = owner;

    // Mint some ROSE tokens for testing
    await roseToken.connect(owner).mint(user1.address, ethers.parseEther("10000"));
    await roseToken.connect(owner).mint(user2.address, ethers.parseEther("10000"));
    await roseToken.connect(owner).mint(proposer.address, ethers.parseEther("10000"));
    await roseToken.connect(owner).mint(owner.address, ethers.parseEther("100000")); // Treasury
  });

  describe("Deployment", function () {
    it("Should set correct token addresses", async function () {
      expect(await governance.roseToken()).to.equal(await roseToken.getAddress());
      expect(await governance.vRoseToken()).to.equal(await vRose.getAddress());
    });

    it("Should set correct admin addresses", async function () {
      expect(await governance.owner()).to.equal(owner.address);
      expect(await governance.passportSigner()).to.equal(passportSigner.address);
    });

    it("Should start with zero proposal counter", async function () {
      expect(await governance.proposalCounter()).to.equal(0);
    });

    it("Should start with zero total staked", async function () {
      expect(await governance.totalStakedRose()).to.equal(0);
    });

    it("Should revert if deployed with zero addresses", async function () {
      const RoseGovernance = await ethers.getContractFactory("RoseGovernance");

      await expect(
        RoseGovernance.deploy(
          ethers.ZeroAddress,
          await vRose.getAddress(),
          user3.address,
          owner.address,
          passportSigner.address
        )
      ).to.be.revertedWithCustomError(governance, "ZeroAddress");
    });
  });

  describe("Staking", function () {
    describe("Deposit", function () {
      it("Should allow deposit and mint vROSE 1:1", async function () {
        const amount = ethers.parseEther("1000");
        await roseToken.connect(user1).approve(await governance.getAddress(), amount);

        await governance.connect(user1).deposit(amount);

        expect(await governance.stakedRose(user1.address)).to.equal(amount);
        expect(await governance.totalStakedRose()).to.equal(amount);
        expect(await vRose.balanceOf(user1.address)).to.equal(amount);
      });

      it("Should emit Deposited event", async function () {
        const amount = ethers.parseEther("1000");
        await roseToken.connect(user1).approve(await governance.getAddress(), amount);

        await expect(governance.connect(user1).deposit(amount))
          .to.emit(governance, "Deposited")
          .withArgs(user1.address, amount);
      });

      it("Should revert on zero amount", async function () {
        await expect(governance.connect(user1).deposit(0))
          .to.be.revertedWithCustomError(governance, "ZeroAmount");
      });
    });

    describe("Withdraw", function () {
      beforeEach(async function () {
        const amount = ethers.parseEther("1000");
        await roseToken.connect(user1).approve(await governance.getAddress(), amount);
        await governance.connect(user1).deposit(amount);
      });

      it("Should allow withdraw and burn vROSE", async function () {
        const withdrawAmount = ethers.parseEther("500");
        const initialBalance = await roseToken.balanceOf(user1.address);

        await governance.connect(user1).withdraw(withdrawAmount);

        expect(await governance.stakedRose(user1.address)).to.equal(ethers.parseEther("500"));
        expect(await vRose.balanceOf(user1.address)).to.equal(ethers.parseEther("500"));
        expect(await roseToken.balanceOf(user1.address)).to.equal(initialBalance + withdrawAmount);
      });

      it("Should emit Withdrawn event", async function () {
        const withdrawAmount = ethers.parseEther("500");

        await expect(governance.connect(user1).withdraw(withdrawAmount))
          .to.emit(governance, "Withdrawn")
          .withArgs(user1.address, withdrawAmount);
      });

      it("Should revert on zero amount", async function () {
        await expect(governance.connect(user1).withdraw(0))
          .to.be.revertedWithCustomError(governance, "ZeroAmount");
      });

      it("Should revert if insufficient unallocated", async function () {
        // This test would require allocating ROSE first (to proposals or delegation)
        // For now, test that we can't withdraw more than staked
        await expect(governance.connect(user1).withdraw(ethers.parseEther("1001")))
          .to.be.revertedWithCustomError(governance, "InsufficientUnallocated");
      });
    });
  });

  describe("Reputation", function () {
    it("Should return default reputation (60) for cold start users", async function () {
      expect(await governance.getReputation(user1.address)).to.equal(60);
    });

    it("Should return 100 for users with completed tasks and no penalties", async function () {
      await setupEligibleProposer(user1);
      expect(await governance.getReputation(user1.address)).to.equal(100);
    });

    it("Should return reduced reputation for users with disputes", async function () {
      // Complete 10 tasks
      for (let i = 0; i < 10; i++) {
        await governance.connect(mockMarketplace).updateUserStats(
          user1.address,
          ethers.parseEther("100"),
          false
        );
      }
      // Add a dispute
      await governance.connect(mockMarketplace).updateUserStats(
        user1.address,
        ethers.parseEther("0"),
        true
      );

      const rep = await governance.getReputation(user1.address);
      expect(rep).to.be.lessThan(100);
    });
  });

  describe("Vote Power", function () {
    it("Should calculate quadratic vote power", async function () {
      // sqrt(100 * 10^18) * 60 / 100 = ~6 * 10^9
      const amount = ethers.parseEther("100");
      const reputation = 60n;

      const votePower = await governance.getVotePower(amount, reputation);

      // sqrt(100 * 10^18) = 10^10
      // 10^10 * 60 / 100 = 6 * 10^9
      expect(votePower).to.equal(6000000000n);
    });

    it("Should return 0 for zero amount", async function () {
      expect(await governance.getVotePower(0, 60)).to.equal(0);
    });

    it("Should return 0 for zero reputation", async function () {
      expect(await governance.getVotePower(ethers.parseEther("100"), 0)).to.equal(0);
    });
  });

  describe("Eligibility", function () {
    describe("canPropose", function () {
      it("Should return false for cold start users", async function () {
        expect(await governance.canPropose(user1.address)).to.equal(false);
      });

      it("Should return true for users with 10+ tasks and 90%+ reputation", async function () {
        await setupEligibleProposer(user1);
        expect(await governance.canPropose(user1.address)).to.equal(true);
      });
    });

    describe("canVote", function () {
      it("Should return false for users with reputation < 70", async function () {
        // Default reputation is 60, which is < 70
        expect(await governance.canVote(user1.address)).to.equal(false);
      });

      it("Should return true for users with 70%+ reputation", async function () {
        await setupEligibleVoter(user1);
        expect(await governance.canVote(user1.address)).to.equal(true);
      });
    });

    describe("canDelegate", function () {
      it("Should return false for cold start users", async function () {
        expect(await governance.canDelegate(user1.address)).to.equal(false);
      });

      it("Should return true for eligible delegates", async function () {
        await setupEligibleProposer(user1);
        expect(await governance.canDelegate(user1.address)).to.equal(true);
      });
    });
  });

  describe("Delegation", function () {
    beforeEach(async function () {
      // Set up user1 as an eligible delegate
      await setupEligibleProposer(user1);

      // user2 deposits ROSE
      const amount = ethers.parseEther("1000");
      await roseToken.connect(user2).approve(await governance.getAddress(), amount);
      await governance.connect(user2).deposit(amount);
    });

    it("Should allow delegation to eligible delegate", async function () {
      const amount = ethers.parseEther("500");

      await governance.connect(user2).allocateToDelegate(user1.address, amount);

      expect(await governance.delegatedTo(user2.address)).to.equal(user1.address);
      expect(await governance.allocatedRose(user2.address)).to.equal(amount);
    });

    it("Should emit DelegatedTo event", async function () {
      const amount = ethers.parseEther("500");

      await expect(governance.connect(user2).allocateToDelegate(user1.address, amount))
        .to.emit(governance, "DelegatedTo")
        .withArgs(user2.address, user1.address, amount);
    });

    it("Should revert if delegating to self", async function () {
      const amount = ethers.parseEther("500");

      await expect(governance.connect(user2).allocateToDelegate(user2.address, amount))
        .to.be.revertedWithCustomError(governance, "CannotDelegateToSelf");
    });

    it("Should revert if delegate is ineligible", async function () {
      const amount = ethers.parseEther("500");

      // user3 hasn't completed tasks, so ineligible
      await expect(governance.connect(user2).allocateToDelegate(user3.address, amount))
        .to.be.revertedWithCustomError(governance, "IneligibleToDelegate");
    });

    it("Should revert if already delegating", async function () {
      const amount = ethers.parseEther("250");

      await governance.connect(user2).allocateToDelegate(user1.address, amount);

      await expect(governance.connect(user2).allocateToDelegate(user1.address, amount))
        .to.be.revertedWithCustomError(governance, "AlreadyDelegating");
    });

    describe("Undelegation", function () {
      beforeEach(async function () {
        const amount = ethers.parseEther("500");
        await governance.connect(user2).allocateToDelegate(user1.address, amount);
      });

      it("Should allow undelegation", async function () {
        await governance.connect(user2).unallocateFromDelegate();

        expect(await governance.delegatedTo(user2.address)).to.equal(ethers.ZeroAddress);
        expect(await governance.cachedVotePower(user2.address)).to.equal(0);
      });

      it("Should emit Undelegated event", async function () {
        await expect(governance.connect(user2).unallocateFromDelegate())
          .to.emit(governance, "Undelegated");
      });

      it("Should revert if not delegating", async function () {
        await governance.connect(user2).unallocateFromDelegate();

        await expect(governance.connect(user2).unallocateFromDelegate())
          .to.be.revertedWithCustomError(governance, "NotDelegating");
      });
    });

    describe("Refresh Delegation", function () {
      beforeEach(async function () {
        const amount = ethers.parseEther("500");
        await governance.connect(user2).allocateToDelegate(user1.address, amount);
      });

      it("Should refresh delegation vote power", async function () {
        const oldPower = await governance.cachedVotePower(user2.address);

        // Complete some tasks to change reputation
        for (let i = 0; i < 10; i++) {
          await governance.connect(mockMarketplace).updateUserStats(
            user2.address,
            ethers.parseEther("100"),
            false
          );
        }

        await governance.refreshDelegation(user2.address);

        const newPower = await governance.cachedVotePower(user2.address);
        expect(newPower).to.not.equal(oldPower);
      });

      it("Should emit DelegationRefreshed event", async function () {
        await expect(governance.refreshDelegation(user2.address))
          .to.emit(governance, "DelegationRefreshed");
      });

      it("Should do nothing if user is not delegating", async function () {
        // user3 is not delegating
        await governance.refreshDelegation(user3.address);
        expect(await governance.cachedVotePower(user3.address)).to.equal(0);
      });
    });
  });

  describe("Proposals", function () {
    beforeEach(async function () {
      // Set up proposer as eligible
      await setupEligibleProposer(proposer);

      // Deposit some ROSE
      const amount = ethers.parseEther("1000");
      await roseToken.connect(proposer).approve(await governance.getAddress(), amount);
      await governance.connect(proposer).deposit(amount);
    });

    describe("Create Proposal", function () {
      it("Should create a proposal with valid signature", async function () {
        const expiry = (await time.latest()) + 3600;
        const signature = await createSignature(passportSigner, proposer.address, "propose", expiry);

        await governance.connect(proposer).propose(
          "Test Proposal",
          "QmHash123",
          ethers.parseEther("1000"),
          (await time.latest()) + 30 * 24 * 60 * 60,
          "Test deliverables",
          expiry,
          signature
        );

        expect(await governance.proposalCounter()).to.equal(1);

        const proposal = await governance.proposals(1);
        expect(proposal.proposer).to.equal(proposer.address);
        expect(proposal.title).to.equal("Test Proposal");
        expect(proposal.value).to.equal(ethers.parseEther("1000"));
      });

      it("Should emit ProposalCreated event", async function () {
        const expiry = (await time.latest()) + 3600;
        const signature = await createSignature(passportSigner, proposer.address, "propose", expiry);

        await expect(governance.connect(proposer).propose(
          "Test Proposal",
          "QmHash123",
          ethers.parseEther("1000"),
          (await time.latest()) + 30 * 24 * 60 * 60,
          "Test deliverables",
          expiry,
          signature
        )).to.emit(governance, "ProposalCreated")
          .withArgs(1, proposer.address, ethers.parseEther("1000"));
      });

      it("Should revert with expired signature", async function () {
        const expiry = (await time.latest()) - 1; // Already expired
        const signature = await createSignature(passportSigner, proposer.address, "propose", expiry);

        await expect(governance.connect(proposer).propose(
          "Test Proposal",
          "QmHash123",
          ethers.parseEther("1000"),
          (await time.latest()) + 30 * 24 * 60 * 60,
          "Test deliverables",
          expiry,
          signature
        )).to.be.revertedWithCustomError(governance, "SignatureExpired");
      });

      it("Should revert if ineligible to propose", async function () {
        const expiry = (await time.latest()) + 3600;
        const signature = await createSignature(passportSigner, user1.address, "propose", expiry);

        // user1 hasn't completed tasks
        await expect(governance.connect(user1).propose(
          "Test Proposal",
          "QmHash123",
          ethers.parseEther("1000"),
          (await time.latest()) + 30 * 24 * 60 * 60,
          "Test deliverables",
          expiry,
          signature
        )).to.be.revertedWithCustomError(governance, "IneligibleToPropose");
      });

      it("Should revert if value exceeds treasury balance", async function () {
        const expiry = (await time.latest()) + 3600;
        const signature = await createSignature(passportSigner, proposer.address, "propose", expiry);

        await expect(governance.connect(proposer).propose(
          "Test Proposal",
          "QmHash123",
          ethers.parseEther("1000000"), // More than treasury
          (await time.latest()) + 30 * 24 * 60 * 60,
          "Test deliverables",
          expiry,
          signature
        )).to.be.revertedWithCustomError(governance, "ProposalValueExceedsTreasury");
      });
    });

    describe("Edit Proposal", function () {
      let proposalId;

      beforeEach(async function () {
        const expiry = (await time.latest()) + 3600;
        const signature = await createSignature(passportSigner, proposer.address, "propose", expiry);

        await governance.connect(proposer).propose(
          "Test Proposal",
          "QmHash123",
          ethers.parseEther("1000"),
          (await time.latest()) + 30 * 24 * 60 * 60,
          "Test deliverables",
          expiry,
          signature
        );
        proposalId = 1;
      });

      it("Should allow proposer to edit their proposal", async function () {
        await governance.connect(proposer).editProposal(
          proposalId,
          "Updated Proposal",
          "QmHash456",
          ethers.parseEther("2000"),
          (await time.latest()) + 60 * 24 * 60 * 60,
          "Updated deliverables"
        );

        const proposal = await governance.proposals(proposalId);
        expect(proposal.title).to.equal("Updated Proposal");
        expect(proposal.value).to.equal(ethers.parseEther("2000"));
        expect(proposal.editCount).to.equal(1);
      });

      it("Should emit ProposalEdited event", async function () {
        await expect(governance.connect(proposer).editProposal(
          proposalId,
          "Updated Proposal",
          "QmHash456",
          ethers.parseEther("2000"),
          (await time.latest()) + 60 * 24 * 60 * 60,
          "Updated deliverables"
        )).to.emit(governance, "ProposalEdited")
          .withArgs(proposalId, 1);
      });

      it("Should revert if not proposer", async function () {
        await expect(governance.connect(user1).editProposal(
          proposalId,
          "Updated Proposal",
          "QmHash456",
          ethers.parseEther("2000"),
          (await time.latest()) + 60 * 24 * 60 * 60,
          "Updated deliverables"
        )).to.be.revertedWithCustomError(governance, "OnlyProposerCanEdit");
      });

      it("Should revert if max edit cycles reached", async function () {
        // Edit 4 times
        for (let i = 0; i < 4; i++) {
          await governance.connect(proposer).editProposal(
            proposalId,
            `Updated ${i}`,
            "QmHash",
            ethers.parseEther("1000"),
            (await time.latest()) + 30 * 24 * 60 * 60,
            "Deliverables"
          );
        }

        // 5th edit should fail
        await expect(governance.connect(proposer).editProposal(
          proposalId,
          "Final Update",
          "QmHash",
          ethers.parseEther("1000"),
          (await time.latest()) + 30 * 24 * 60 * 60,
          "Deliverables"
        )).to.be.revertedWithCustomError(governance, "MaxEditCyclesReached");
      });
    });

    describe("Cancel Proposal", function () {
      let proposalId;

      beforeEach(async function () {
        const expiry = (await time.latest()) + 3600;
        const signature = await createSignature(passportSigner, proposer.address, "propose", expiry);

        await governance.connect(proposer).propose(
          "Test Proposal",
          "QmHash123",
          ethers.parseEther("1000"),
          (await time.latest()) + 30 * 24 * 60 * 60,
          "Test deliverables",
          expiry,
          signature
        );
        proposalId = 1;
      });

      it("Should allow proposer to cancel their proposal", async function () {
        await governance.connect(proposer).cancelProposal(proposalId);

        const proposal = await governance.proposals(proposalId);
        expect(proposal.status).to.equal(4); // Cancelled = 4
      });

      it("Should emit ProposalCancelled event", async function () {
        await expect(governance.connect(proposer).cancelProposal(proposalId))
          .to.emit(governance, "ProposalCancelled")
          .withArgs(proposalId);
      });

      it("Should revert if not proposer", async function () {
        await expect(governance.connect(user1).cancelProposal(proposalId))
          .to.be.revertedWithCustomError(governance, "OnlyProposerCanCancel");
      });
    });
  });

  describe("Voting", function () {
    let proposalId;

    beforeEach(async function () {
      // Set up proposer
      await setupEligibleProposer(proposer);
      await roseToken.connect(proposer).approve(await governance.getAddress(), ethers.parseEther("1000"));
      await governance.connect(proposer).deposit(ethers.parseEther("1000"));

      // Create proposal
      const expiry = (await time.latest()) + 3600;
      const signature = await createSignature(passportSigner, proposer.address, "propose", expiry);
      await governance.connect(proposer).propose(
        "Test Proposal",
        "QmHash123",
        ethers.parseEther("1000"),
        (await time.latest()) + 30 * 24 * 60 * 60,
        "Test deliverables",
        expiry,
        signature
      );
      proposalId = 1;

      // Set up voters
      await setupEligibleVoter(user1);
      await setupEligibleVoter(user2);

      // Deposit ROSE for voting
      await roseToken.connect(user1).approve(await governance.getAddress(), ethers.parseEther("5000"));
      await governance.connect(user1).deposit(ethers.parseEther("5000"));
      await roseToken.connect(user2).approve(await governance.getAddress(), ethers.parseEther("5000"));
      await governance.connect(user2).deposit(ethers.parseEther("5000"));
    });

    describe("Allocate to Proposal", function () {
      it("Should allow eligible voter to vote", async function () {
        const amount = ethers.parseEther("1000");

        await governance.connect(user1).allocateToProposal(proposalId, amount, true);

        const vote = await governance.votes(proposalId, user1.address);
        expect(vote.hasVoted).to.equal(true);
        expect(vote.support).to.equal(true);
        expect(vote.allocatedAmount).to.equal(amount);
      });

      it("Should emit VoteCast event", async function () {
        const amount = ethers.parseEther("1000");

        await expect(governance.connect(user1).allocateToProposal(proposalId, amount, true))
          .to.emit(governance, "VoteCast");
      });

      it("Should update proposal vote tallies", async function () {
        await governance.connect(user1).allocateToProposal(proposalId, ethers.parseEther("1000"), true);
        await governance.connect(user2).allocateToProposal(proposalId, ethers.parseEther("500"), false);

        const proposal = await governance.proposals(proposalId);
        expect(proposal.yayVotes).to.be.greaterThan(0);
        expect(proposal.nayVotes).to.be.greaterThan(0);
        expect(proposal.totalAllocated).to.equal(ethers.parseEther("1500"));
      });

      it("Should revert if ineligible to vote", async function () {
        // user3 hasn't completed tasks
        await roseToken.connect(owner).mint(user3.address, ethers.parseEther("1000"));
        await roseToken.connect(user3).approve(await governance.getAddress(), ethers.parseEther("1000"));
        await governance.connect(user3).deposit(ethers.parseEther("1000"));

        await expect(governance.connect(user3).allocateToProposal(proposalId, ethers.parseEther("100"), true))
          .to.be.revertedWithCustomError(governance, "IneligibleToVote");
      });

      it("Should revert if proposer tries to vote on own proposal", async function () {
        await expect(governance.connect(proposer).allocateToProposal(proposalId, ethers.parseEther("100"), true))
          .to.be.revertedWithCustomError(governance, "CannotVoteOnOwnProposal");
      });

      it("Should revert if already voted", async function () {
        await governance.connect(user1).allocateToProposal(proposalId, ethers.parseEther("500"), true);

        await expect(governance.connect(user1).allocateToProposal(proposalId, ethers.parseEther("500"), true))
          .to.be.revertedWithCustomError(governance, "AlreadyVoted");
      });
    });

    describe("Unallocate from Proposal", function () {
      beforeEach(async function () {
        await governance.connect(user1).allocateToProposal(proposalId, ethers.parseEther("1000"), true);
      });

      it("Should revert if proposal still active", async function () {
        await expect(governance.connect(user1).unallocateFromProposal(proposalId))
          .to.be.revertedWithCustomError(governance, "ProposalNotEnded");
      });

      it("Should allow unallocation after voting ends", async function () {
        // Fast forward past voting period
        await time.increase(VOTING_PERIOD + 1);

        const allocatedBefore = await governance.allocatedRose(user1.address);
        await governance.connect(user1).unallocateFromProposal(proposalId);
        const allocatedAfter = await governance.allocatedRose(user1.address);

        expect(allocatedAfter).to.be.lessThan(allocatedBefore);
      });

      it("Should emit VoteUnallocated event", async function () {
        await time.increase(VOTING_PERIOD + 1);

        await expect(governance.connect(user1).unallocateFromProposal(proposalId))
          .to.emit(governance, "VoteUnallocated")
          .withArgs(proposalId, user1.address, ethers.parseEther("1000"));
      });
    });

    describe("Delegated Voting", function () {
      beforeEach(async function () {
        // Set up user1 as delegate
        await setupEligibleProposer(user1);

        // user2 delegates to user1
        await governance.connect(user2).allocateToDelegate(user1.address, ethers.parseEther("2000"));
      });

      it("Should allow delegate to cast delegated vote", async function () {
        await governance.connect(user1).castDelegatedVote(proposalId, true);

        const proposal = await governance.proposals(proposalId);
        expect(proposal.yayVotes).to.be.greaterThan(0);
      });

      it("Should emit DelegatedVoteCast event", async function () {
        await expect(governance.connect(user1).castDelegatedVote(proposalId, true))
          .to.emit(governance, "DelegatedVoteCast");
      });

      it("Should revert if no delegated power", async function () {
        // user3 has no delegated power
        await expect(governance.connect(user3).castDelegatedVote(proposalId, true))
          .to.be.revertedWithCustomError(governance, "ZeroAmount");
      });
    });
  });

  describe("Proposal Finalization", function () {
    let proposalId;

    beforeEach(async function () {
      // Set up proposer
      await setupEligibleProposer(proposer);
      await roseToken.connect(proposer).approve(await governance.getAddress(), ethers.parseEther("1000"));
      await governance.connect(proposer).deposit(ethers.parseEther("1000"));

      // Create proposal
      const expiry = (await time.latest()) + 3600;
      const signature = await createSignature(passportSigner, proposer.address, "propose", expiry);
      await governance.connect(proposer).propose(
        "Test Proposal",
        "QmHash123",
        ethers.parseEther("1000"),
        (await time.latest()) + 30 * 24 * 60 * 60,
        "Test deliverables",
        expiry,
        signature
      );
      proposalId = 1;

      // Set up voters
      await setupEligibleVoter(user1);
      await setupEligibleVoter(user2);
      await roseToken.connect(user1).approve(await governance.getAddress(), ethers.parseEther("5000"));
      await governance.connect(user1).deposit(ethers.parseEther("5000"));
      await roseToken.connect(user2).approve(await governance.getAddress(), ethers.parseEther("5000"));
      await governance.connect(user2).deposit(ethers.parseEther("5000"));
    });

    it("Should revert if voting not ended", async function () {
      await expect(governance.finalizeProposal(proposalId))
        .to.be.revertedWithCustomError(governance, "ProposalNotEnded");
    });

    it("Should reset timer if quorum not met", async function () {
      // Vote with small amount (won't meet quorum)
      await governance.connect(user1).allocateToProposal(proposalId, ethers.parseEther("10"), true);

      await time.increase(VOTING_PERIOD + 1);

      await governance.finalizeProposal(proposalId);

      const proposal = await governance.proposals(proposalId);
      expect(proposal.status).to.equal(0); // Still Active
    });

    it("Should pass proposal if yay votes meet threshold", async function () {
      // Need 33% quorum and 58.33% yay votes
      // Total staked = 11000 (1000 proposer + 5000 user1 + 5000 user2)
      // Quorum = 33% of 11000 = 3630
      // Vote with enough to meet quorum
      await governance.connect(user1).allocateToProposal(proposalId, ethers.parseEther("4000"), true);

      await time.increase(VOTING_PERIOD + 1);

      await governance.finalizeProposal(proposalId);

      const proposal = await governance.proposals(proposalId);
      expect(proposal.status).to.equal(1); // Passed
    });

    it("Should fail proposal if nay votes exceed threshold", async function () {
      // Vote mostly nay
      await governance.connect(user1).allocateToProposal(proposalId, ethers.parseEther("1000"), true);
      await governance.connect(user2).allocateToProposal(proposalId, ethers.parseEther("3000"), false);

      await time.increase(VOTING_PERIOD + 1);

      await governance.finalizeProposal(proposalId);

      const proposal = await governance.proposals(proposalId);
      expect(proposal.status).to.equal(2); // Failed
    });

    it("Should emit ProposalFinalized event", async function () {
      await governance.connect(user1).allocateToProposal(proposalId, ethers.parseEther("4000"), true);
      await time.increase(VOTING_PERIOD + 1);

      await expect(governance.finalizeProposal(proposalId))
        .to.emit(governance, "ProposalFinalized");
    });
  });

  describe("Quorum and Vote Results", function () {
    let proposalId;

    beforeEach(async function () {
      await setupEligibleProposer(proposer);
      await roseToken.connect(proposer).approve(await governance.getAddress(), ethers.parseEther("1000"));
      await governance.connect(proposer).deposit(ethers.parseEther("1000"));

      const expiry = (await time.latest()) + 3600;
      const signature = await createSignature(passportSigner, proposer.address, "propose", expiry);
      await governance.connect(proposer).propose(
        "Test",
        "QmHash",
        ethers.parseEther("100"),
        (await time.latest()) + 30 * 24 * 60 * 60,
        "Deliverables",
        expiry,
        signature
      );
      proposalId = 1;
    });

    it("Should return quorum progress", async function () {
      const [current, required] = await governance.getQuorumProgress(proposalId);
      expect(current).to.equal(0);
      expect(required).to.be.greaterThan(0);
    });

    it("Should return vote result percentages", async function () {
      await setupEligibleVoter(user1);
      await setupEligibleVoter(user2);
      await roseToken.connect(user1).approve(await governance.getAddress(), ethers.parseEther("1000"));
      await governance.connect(user1).deposit(ethers.parseEther("1000"));
      await roseToken.connect(user2).approve(await governance.getAddress(), ethers.parseEther("1000"));
      await governance.connect(user2).deposit(ethers.parseEther("1000"));

      await governance.connect(user1).allocateToProposal(proposalId, ethers.parseEther("700"), true);
      await governance.connect(user2).allocateToProposal(proposalId, ethers.parseEther("300"), false);

      const [yayPercent, nayPercent] = await governance.getVoteResult(proposalId);
      // Vote power is quadratic, so percentages depend on sqrt calculations
      // Allow for small rounding errors
      expect(yayPercent + nayPercent).to.be.closeTo(BASIS_POINTS, 1n);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set passport signer", async function () {
      await governance.setPassportSigner(user1.address);
      expect(await governance.passportSigner()).to.equal(user1.address);
    });

    it("Should emit PassportSignerUpdated event", async function () {
      await expect(governance.setPassportSigner(user1.address))
        .to.emit(governance, "PassportSignerUpdated")
        .withArgs(user1.address);
    });

    it("Should revert if non-owner sets passport signer", async function () {
      await expect(governance.connect(user1).setPassportSigner(user2.address))
        .to.be.revertedWithCustomError(governance, "NotOwner");
    });

    it("Should revert if setting passport signer to zero address", async function () {
      await expect(governance.setPassportSigner(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(governance, "ZeroAddressSigner");
    });

    it("Should allow owner to transfer ownership", async function () {
      await governance.transferOwnership(user1.address);
      expect(await governance.owner()).to.equal(user1.address);
    });

    it("Should revert if non-owner transfers ownership", async function () {
      await expect(governance.connect(user1).transferOwnership(user2.address))
        .to.be.revertedWithCustomError(governance, "NotOwner");
    });

    it("Should allow owner to set marketplace", async function () {
      await governance.setMarketplace(user1.address);
      expect(await governance.marketplace()).to.equal(user1.address);
    });

    it("Should allow owner to set treasury", async function () {
      await governance.setTreasury(user1.address);
      expect(await governance.treasury()).to.equal(user1.address);
    });
  });

  describe("Marketplace Integration", function () {
    describe("updateUserStats", function () {
      it("Should update stats for completed task", async function () {
        await governance.connect(mockMarketplace).updateUserStats(
          user1.address,
          ethers.parseEther("100"),
          false
        );

        const stats = await governance.userStats(user1.address);
        expect(stats.tasksCompleted).to.equal(1);
        expect(stats.totalTaskValue).to.equal(ethers.parseEther("100"));
      });

      it("Should update stats for dispute", async function () {
        await governance.connect(mockMarketplace).updateUserStats(
          user1.address,
          0,
          true
        );

        const stats = await governance.userStats(user1.address);
        expect(stats.disputes).to.equal(1);
      });

      it("Should emit UserStatsUpdated event", async function () {
        await expect(
          governance.connect(mockMarketplace).updateUserStats(
            user1.address,
            ethers.parseEther("100"),
            false
          )
        ).to.emit(governance, "UserStatsUpdated");
      });

      it("Should revert if not marketplace", async function () {
        await expect(
          governance.connect(user1).updateUserStats(
            user2.address,
            ethers.parseEther("100"),
            false
          )
        ).to.be.revertedWithCustomError(governance, "NotMarketplace");
      });
    });
  });
});
