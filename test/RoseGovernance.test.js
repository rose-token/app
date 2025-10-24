const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RoseGovernance", function() {
  let roseMarketplace;
  let roseToken;
  let roseReputation;
  let roseGovernance;
  let owner;
  let user1;
  let user2;
  let user3;
  let stakeholder;
  let daoTreasury;

  const minimumTokensToPropose = ethers.parseEther("10"); // 10 tokens
  const taskDescription = "DAO-funded task";
  const detailedDescription = "This is a detailed description of a DAO-funded task";
  const taskDeposit = ethers.parseEther("50"); // 50 tokens
  const requiredStake = ethers.parseEther("5"); // 10% of 50 tokens

  beforeEach(async function() {
    [owner, user1, user2, user3, stakeholder, daoTreasury] = await ethers.getSigners();

    const RoseMarketplace = await ethers.getContractFactory("RoseMarketplace");
    roseMarketplace = await RoseMarketplace.deploy(daoTreasury.address);
    await roseMarketplace.waitForDeployment();

    const roseTokenAddress = await roseMarketplace.roseToken();
    roseToken = await ethers.getContractAt("RoseToken", roseTokenAddress);

    const roseReputationAddress = await roseMarketplace.roseReputation();
    roseReputation = await ethers.getContractAt("RoseReputation", roseReputationAddress);

    const RoseGovernance = await ethers.getContractFactory("RoseGovernance");
    roseGovernance = await RoseGovernance.deploy(
      roseTokenAddress,
      roseReputationAddress,
      await roseMarketplace.getAddress(),
      minimumTokensToPropose
    );
    await roseGovernance.waitForDeployment();

    await roseMarketplace.setGovernanceContract(await roseGovernance.getAddress());

    for (let i = 0; i < 5; i++) {
      await roseMarketplace.claimFaucetTokens(ethers.parseEther("100"));
    }

    await roseToken.transfer(user1.address, ethers.parseEther("100"));
    await roseToken.transfer(user2.address, ethers.parseEther("100"));
    await roseToken.transfer(user3.address, ethers.parseEther("100"));
    await roseToken.transfer(stakeholder.address, ethers.parseEther("100"));
    await roseToken.transfer(daoTreasury.address, ethers.parseEther("200"));

    await roseToken.connect(daoTreasury).approve(await roseMarketplace.getAddress(), ethers.parseEther("500"));
  });

  describe("Token Locking", function() {
    it("Should allow users to lock tokens", async function() {
      await roseToken.connect(user1).approve(await roseGovernance.getAddress(), ethers.parseEther("50"));

      const blockNumBefore = await ethers.provider.getBlockNumber();
      const blockBefore = await ethers.provider.getBlock(blockNumBefore);
      const timestampBefore = blockBefore.timestamp;
      const lockDuration = 7 * 24 * 60 * 60; // 7 days
      const expectedUnlockTime = timestampBefore + lockDuration;

      const lockTx = await roseGovernance.connect(user1).lockTokens(ethers.parseEther("50"), lockDuration);

      expect(await roseGovernance.lockedTokens(user1.address)).to.equal(ethers.parseEther("50"));

      const actualUnlockTime = await roseGovernance.lockEndTime(user1.address);

      expect(actualUnlockTime).to.be.closeTo(expectedUnlockTime, 5);

      await expect(lockTx)
        .to.emit(roseGovernance, "TokensLocked")
        .withArgs(user1.address, ethers.parseEther("50"), actualUnlockTime);
    });

    it("Should not allow unlocking tokens before lock period ends", async function() {
      await roseToken.connect(user1).approve(await roseGovernance.getAddress(), ethers.parseEther("50"));
      await roseGovernance.connect(user1).lockTokens(ethers.parseEther("50"), 7 * 24 * 60 * 60);

      await expect(
        roseGovernance.connect(user1).unlockTokens()
      ).to.be.revertedWith("Lock period not ended");
    });
  });

  describe("Proposal Creation", function() {
    it("Should allow users to create proposals if they have locked enough tokens", async function() {
      await roseToken.connect(user1).approve(await roseGovernance.getAddress(), ethers.parseEther("20"));
      await roseGovernance.connect(user1).lockTokens(ethers.parseEther("20"), 7 * 24 * 60 * 60);

      await expect(
        roseGovernance.connect(user1).createTaskProposal(
          taskDescription,
          detailedDescription,
          taskDeposit,
          0, // ProposalType.Work
          0, // FundingSource.DAO
          "" // empty IPFS hash
        )
      )
        .to.emit(roseGovernance, "ProposalCreated")
        .withArgs(1, user1.address, taskDescription, taskDeposit);
    });

    it("Should not allow proposal creation without sufficient locked tokens", async function() {
      await roseToken.connect(user1).approve(await roseGovernance.getAddress(), ethers.parseEther("5"));
      await roseGovernance.connect(user1).lockTokens(ethers.parseEther("5"), 7 * 24 * 60 * 60);

      await expect(
        roseGovernance.connect(user1).createTaskProposal(
          taskDescription,
          detailedDescription,
          taskDeposit,
          0, // ProposalType.Work
          0, // FundingSource.DAO
          "" // empty IPFS hash
        )
      ).to.be.revertedWith("Insufficient tokens locked to propose");
    });
  });

  describe("Stakeholder Staking", function() {
    beforeEach(async function() {
      await roseToken.connect(user1).approve(await roseGovernance.getAddress(), ethers.parseEther("20"));
      await roseGovernance.connect(user1).lockTokens(ethers.parseEther("20"), 7 * 24 * 60 * 60);

      await roseGovernance.connect(user1).createTaskProposal(
        taskDescription,
        detailedDescription,
        taskDeposit,
        0, // ProposalType.Work
        0, // FundingSource.DAO
        "" // empty IPFS hash
      );
    });

    it("Should allow stakeholder to stake 10% on a proposal", async function() {
      await roseToken.connect(stakeholder).approve(await roseGovernance.getAddress(), requiredStake);

      await expect(
        roseGovernance.connect(stakeholder).stakeOnProposal(1)
      )
        .to.emit(roseGovernance, "ProposalStaked")
        .withArgs(1, stakeholder.address, requiredStake);

      const proposal = await roseGovernance.proposals(1);
      expect(proposal.stakeholder).to.equal(stakeholder.address);
      expect(proposal.stakedAmount).to.equal(requiredStake);
      expect(proposal.status).to.equal(1); // Staked status
    });

    it("Should not allow proposer to stake on their own proposal", async function() {
      await roseToken.connect(user1).approve(await roseGovernance.getAddress(), requiredStake);

      await expect(
        roseGovernance.connect(user1).stakeOnProposal(1)
      ).to.be.revertedWith("Proposer cannot stake on their own proposal");
    });

    it("Should not allow staking on already staked proposal", async function() {
      await roseToken.connect(stakeholder).approve(await roseGovernance.getAddress(), requiredStake);
      await roseGovernance.connect(stakeholder).stakeOnProposal(1);

      await roseToken.connect(user2).approve(await roseGovernance.getAddress(), requiredStake);

      await expect(
        roseGovernance.connect(user2).stakeOnProposal(1)
      ).to.be.revertedWith("Proposal already has a stakeholder");
    });
  });

  describe("Proposal Approval", function() {
    beforeEach(async function() {
      await roseToken.connect(user1).approve(await roseGovernance.getAddress(), ethers.parseEther("20"));
      await roseGovernance.connect(user1).lockTokens(ethers.parseEther("20"), 7 * 24 * 60 * 60);

      await roseGovernance.connect(user1).createTaskProposal(
        taskDescription,
        detailedDescription,
        taskDeposit,
        0, // ProposalType.Work
        0, // FundingSource.DAO
        "" // empty IPFS hash
      );

      await roseToken.connect(stakeholder).approve(await roseGovernance.getAddress(), requiredStake);
      await roseGovernance.connect(stakeholder).stakeOnProposal(1);
    });

    it("Should allow stakeholder to approve proposal", async function() {
      const blockNumBefore = await ethers.provider.getBlockNumber();
      const blockBefore = await ethers.provider.getBlock(blockNumBefore);
      const timestampBefore = blockBefore.timestamp;

      await expect(
        roseGovernance.connect(stakeholder).approveProposal(1)
      )
        .to.emit(roseGovernance, "ProposalApproved")
        .withArgs(1, stakeholder.address);

      const proposal = await roseGovernance.proposals(1);
      expect(proposal.status).to.equal(2); // Approved status

      // Check execution time is set to ~2 days from now
      const executionDelay = 2 * 24 * 60 * 60; // 2 days
      const expectedExecutionTime = timestampBefore + executionDelay;
      expect(proposal.executionTime).to.be.closeTo(expectedExecutionTime, 5);
    });

    it("Should not allow non-stakeholder to approve proposal", async function() {
      await expect(
        roseGovernance.connect(user2).approveProposal(1)
      ).to.be.revertedWith("Only the stakeholder can approve");
    });

    it("Should not allow approving proposal that is not staked", async function() {
      // Create another proposal
      await roseGovernance.connect(user1).createTaskProposal(
        "Another task",
        "Another description",
        taskDeposit,
        0,
        0,
        ""
      );

      await expect(
        roseGovernance.connect(stakeholder).approveProposal(2)
      ).to.be.revertedWith("Only the stakeholder can approve");
    });
  });

  describe("Proposal Rejection", function() {
    beforeEach(async function() {
      await roseToken.connect(user1).approve(await roseGovernance.getAddress(), ethers.parseEther("20"));
      await roseGovernance.connect(user1).lockTokens(ethers.parseEther("20"), 7 * 24 * 60 * 60);

      await roseGovernance.connect(user1).createTaskProposal(
        taskDescription,
        detailedDescription,
        taskDeposit,
        0, // ProposalType.Work
        0, // FundingSource.DAO
        "" // empty IPFS hash
      );
    });

    it("Should allow stakeholder to reject proposal and get stake back", async function() {
      await roseToken.connect(stakeholder).approve(await roseGovernance.getAddress(), requiredStake);
      await roseGovernance.connect(stakeholder).stakeOnProposal(1);

      const balanceBefore = await roseToken.balanceOf(stakeholder.address);

      await expect(
        roseGovernance.connect(stakeholder).rejectProposal(1)
      )
        .to.emit(roseGovernance, "ProposalRejected")
        .withArgs(1);

      const balanceAfter = await roseToken.balanceOf(stakeholder.address);
      expect(balanceAfter - balanceBefore).to.equal(requiredStake);

      const proposal = await roseGovernance.proposals(1);
      expect(proposal.status).to.equal(3); // Rejected status
      expect(proposal.stakedAmount).to.equal(0);
    });

    it("Should allow proposer to reject their own proposal", async function() {
      await expect(
        roseGovernance.connect(user1).rejectProposal(1)
      )
        .to.emit(roseGovernance, "ProposalRejected")
        .withArgs(1);

      const proposal = await roseGovernance.proposals(1);
      expect(proposal.status).to.equal(3); // Rejected status
    });

    it("Should not allow non-stakeholder/non-proposer to reject", async function() {
      await expect(
        roseGovernance.connect(user2).rejectProposal(1)
      ).to.be.revertedWith("Only stakeholder or proposer can reject");
    });
  });

  describe("Proposal Execution", function() {
    beforeEach(async function() {
      await roseToken.connect(user1).approve(await roseGovernance.getAddress(), ethers.parseEther("20"));
      await roseGovernance.connect(user1).lockTokens(ethers.parseEther("20"), 7 * 24 * 60 * 60);

      await roseGovernance.connect(user1).createTaskProposal(
        taskDescription,
        detailedDescription,
        taskDeposit,
        0, // ProposalType.Work
        0, // FundingSource.DAO
        "" // empty IPFS hash
      );

      await roseToken.connect(stakeholder).approve(await roseGovernance.getAddress(), requiredStake);
      await roseGovernance.connect(stakeholder).stakeOnProposal(1);
      await roseGovernance.connect(stakeholder).approveProposal(1);
    });

    it("Should not allow execution before execution delay", async function() {
      await expect(
        roseGovernance.connect(user1).executeProposal(1)
      ).to.be.revertedWith("Execution delay not passed");
    });

    it("Should execute approved proposal after delay and return stake", async function() {
      await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");

      const balanceBefore = await roseToken.balanceOf(stakeholder.address);

      await expect(
        roseGovernance.connect(user1).executeProposal(1)
      )
        .to.emit(roseGovernance, "ProposalExecuted");

      const balanceAfter = await roseToken.balanceOf(stakeholder.address);
      expect(balanceAfter - balanceBefore).to.equal(requiredStake);

      const proposal = await roseGovernance.proposals(1);
      expect(proposal.status).to.equal(4); // Executed status
      expect(proposal.stakedAmount).to.equal(0);

      const task = await roseMarketplace.tasks(1);
      expect(task.customer).to.equal(daoTreasury.address);
      expect(task.deposit).to.equal(taskDeposit);
      expect(task.description).to.equal(taskDescription);
    });

    it("Should not allow execution of non-approved proposal", async function() {
      // Create another proposal
      await roseGovernance.connect(user1).createTaskProposal(
        "Another task",
        "Another description",
        taskDeposit,
        0,
        0,
        ""
      );

      await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");

      await expect(
        roseGovernance.connect(user1).executeProposal(2)
      ).to.be.revertedWith("Proposal not approved");
    });
  });
});
