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
  let daoTreasury;
  
  const minimumTokensToPropose = ethers.parseEther("10"); // 10 tokens
  const taskDescription = "DAO-funded task";
  const detailedDescription = "This is a detailed description of a DAO-funded task";
  const taskDeposit = ethers.parseEther("50"); // 50 tokens
  
  beforeEach(async function() {
    [owner, user1, user2, user3, daoTreasury] = await ethers.getSigners();
    
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
  
  describe("Voting", function() {
    beforeEach(async function() {
      for (const user of [user1, user2, user3]) {
        await roseToken.connect(user).approve(await roseGovernance.getAddress(), ethers.parseEther("50"));
        await roseGovernance.connect(user).lockTokens(ethers.parseEther("50"), 7 * 24 * 60 * 60);
      }
      
      await roseGovernance.connect(user1).createTaskProposal(
        taskDescription,
        detailedDescription,
        taskDeposit,
        0, // ProposalType.Work
        0, // FundingSource.DAO
        "" // empty IPFS hash
      );
    });
    
    it("Should allow users to vote with scores 0-5", async function() {
      await expect(
        roseGovernance.connect(user2).vote(1, 4)
      )
        .to.emit(roseGovernance, "VoteCast")
        .withArgs(1, user2.address, 4);
      
      await expect(
        roseGovernance.connect(user3).vote(1, 2)
      )
        .to.emit(roseGovernance, "VoteCast")
        .withArgs(1, user3.address, 2);
    });
    
    it("Should reject invalid scores", async function() {
      await expect(
        roseGovernance.connect(user2).vote(1, 6)
      ).to.be.revertedWith("Score must be between 0 and 5");
    });
    
    it("Should not allow voting without locked tokens", async function() {
      const [_, __, ___, ____, user4] = await ethers.getSigners();
      
      await expect(
        roseGovernance.connect(user4).vote(1, 3)
      ).to.be.revertedWith("Must lock tokens to vote");
    });
  });
  
  describe("Proposal Finalization", function() {
    beforeEach(async function() {
      for (const user of [user1, user2, user3]) {
        await roseToken.connect(user).approve(await roseGovernance.getAddress(), ethers.parseEther("50"));
        await roseGovernance.connect(user).lockTokens(ethers.parseEther("50"), 7 * 24 * 60 * 60);
      }
      
      await roseGovernance.connect(user1).createTaskProposal(
        taskDescription,
        detailedDescription,
        taskDeposit,
        0, // ProposalType.Work
        0, // FundingSource.DAO
        "" // empty IPFS hash
      );
      
      await roseGovernance.connect(user1).vote(1, 5); // Proposer votes max
      await roseGovernance.connect(user2).vote(1, 4);
      await roseGovernance.connect(user3).vote(1, 3);
    });
    
  
    
    it("Should approve proposal if it meets threshold", async function() {
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      
      await expect(
        roseGovernance.connect(user1).finalizeProposal(1)
      )
        .to.emit(roseGovernance, "ProposalApproved");
    });
  });
  
  describe("Proposal Execution", function() {
    beforeEach(async function() {
      for (const user of [user1, user2, user3]) {
        await roseToken.connect(user).approve(await roseGovernance.getAddress(), ethers.parseEther("50"));
        await roseGovernance.connect(user).lockTokens(ethers.parseEther("50"), 7 * 24 * 60 * 60);
      }
      
      await roseGovernance.connect(user1).createTaskProposal(
        taskDescription,
        detailedDescription,
        taskDeposit,
        0, // ProposalType.Work
        0, // FundingSource.DAO
        "" // empty IPFS hash
      );
      
      await roseGovernance.connect(user1).vote(1, 5);
      await roseGovernance.connect(user2).vote(1, 4);
      await roseGovernance.connect(user3).vote(1, 3);
      
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      
      await roseGovernance.connect(user1).finalizeProposal(1);
    });
    
    it("Should not allow execution before execution delay", async function() {
      await expect(
        roseGovernance.connect(user1).executeProposal(1)
      ).to.be.revertedWith("Execution delay not passed");
    });
    
    it("Should execute approved proposal after delay", async function() {
      await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      
      await expect(
        roseGovernance.connect(user1).executeProposal(1)
      )
        .to.emit(roseGovernance, "ProposalExecuted");
      
      const task = await roseMarketplace.tasks(1);
      expect(task.customer).to.equal(daoTreasury.address);
      expect(task.deposit).to.equal(taskDeposit);
      expect(task.description).to.equal(taskDescription);
    });
  });
});
