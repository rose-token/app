const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenStaking", function () {
  let tokenStaking, roseToken, stakeholderRegistry;
  let owner, stakeholder1, stakeholder2, stakeholder3, daoTreasury;

  beforeEach(async function () {
    [owner, stakeholder1, stakeholder2, stakeholder3, daoTreasury] = await ethers.getSigners();

    const RoseToken = await ethers.getContractFactory("RoseToken");
    roseToken = await RoseToken.deploy(owner.address);
    await roseToken.waitForDeployment();

    const StakeholderRegistry = await ethers.getContractFactory("StakeholderRegistry");
    stakeholderRegistry = await StakeholderRegistry.deploy(
      await roseToken.getAddress()
    );
    await stakeholderRegistry.waitForDeployment();
    
    const TokenStaking = await ethers.getContractFactory("TokenStaking");
    tokenStaking = await TokenStaking.deploy(
      await roseToken.getAddress(), 
      await stakeholderRegistry.getAddress(),
      daoTreasury.address
    );
    await tokenStaking.waitForDeployment();
  });

  describe("Staking Mechanisms", function () {
    it("Should validate stakeholders with sufficient staked tokens", async function () {
      await roseToken.mint(stakeholder1.address, ethers.parseEther("2000"));
      await roseToken.connect(stakeholder1).approve(await tokenStaking.getAddress(), ethers.parseEther("1500"));
      await tokenStaking.connect(stakeholder1).stakeTokens(ethers.parseEther("1500"));
      
      expect(await tokenStaking.isValidStakeholder(stakeholder1.address)).to.be.true;
    });

    it("Should reject stakeholders with insufficient tokens", async function () {
      await roseToken.mint(stakeholder1.address, ethers.parseEther("500"));
      await roseToken.connect(stakeholder1).approve(await tokenStaking.getAddress(), ethers.parseEther("500"));
      
      await expect(
        tokenStaking.connect(stakeholder1).stakeTokens(ethers.parseEther("500"))
      ).to.be.revertedWith("Amount below minimum stake");
      
      expect(await tokenStaking.isValidStakeholder(stakeholder1.address)).to.be.false;
    });

    it("Should allow unstaking after lock period", async function () {
      await roseToken.mint(stakeholder1.address, ethers.parseEther("2000"));
      await roseToken.connect(stakeholder1).approve(await tokenStaking.getAddress(), ethers.parseEther("1500"));
      await tokenStaking.connect(stakeholder1).stakeTokens(ethers.parseEther("1500"));
      
      await ethers.provider.send("evm_increaseTime", [14 * 24 * 60 * 60 + 1]); // 14 days + 1 second
      await ethers.provider.send("evm_mine");
      
      await tokenStaking.connect(stakeholder1).unstakeTokens(ethers.parseEther("500"));
      
      expect(await tokenStaking.getStakedAmount(stakeholder1.address)).to.equal(ethers.parseEther("1000"));
    });

    it("Should prevent unstaking during lock period", async function () {
      await roseToken.mint(stakeholder1.address, ethers.parseEther("2000"));
      await roseToken.connect(stakeholder1).approve(await tokenStaking.getAddress(), ethers.parseEther("1500"));
      await tokenStaking.connect(stakeholder1).stakeTokens(ethers.parseEther("1500"));
      
      await expect(
        tokenStaking.connect(stakeholder1).unstakeTokens(ethers.parseEther("500"))
      ).to.be.revertedWith("Tokens still locked");
    });
  });

  describe("Ranked Choice Voting", function () {
    beforeEach(async function () {
      for (let stakeholder of [stakeholder1, stakeholder2, stakeholder3]) {
        await roseToken.mint(stakeholder.address, ethers.parseEther("2000"));
        await roseToken.connect(stakeholder).approve(await tokenStaking.getAddress(), ethers.parseEther("1500"));
        await tokenStaking.connect(stakeholder).stakeTokens(ethers.parseEther("1500"));
      }
      
      await tokenStaking.authorizeContract(owner.address);
    });

    it("Should start an election with multiple candidates", async function () {
      const candidates = [stakeholder1.address, stakeholder2.address, stakeholder3.address];
      const ipfsHash = "QmTestHash123";
      
      const electionId = await tokenStaking.startStakeholderElection(candidates, ipfsHash);
      
      const election = await tokenStaking.getElection(1);
      expect(election.candidates).to.deep.equal(candidates);
      expect(election.ipfsDataHash).to.equal(ipfsHash);
    });

    it("Should allow valid stakeholders to cast ranked choice votes", async function () {
      const candidates = [stakeholder1.address, stakeholder2.address, stakeholder3.address];
      await tokenStaking.startStakeholderElection(candidates, "QmTestHash123");
      
      const preferences = [stakeholder2.address, stakeholder1.address, stakeholder3.address];
      await tokenStaking.connect(stakeholder1).castRankedChoiceVote(1, preferences);
      
      const voterPreferences = await tokenStaking.getVoterPreferences(1, stakeholder1.address);
      expect(voterPreferences).to.deep.equal(preferences);
    });

    it("Should reject votes from non-stakeholders", async function () {
      const candidates = [stakeholder1.address, stakeholder2.address, stakeholder3.address];
      await tokenStaking.startStakeholderElection(candidates, "QmTestHash123");
      
      const [, , , , nonStakeholder] = await ethers.getSigners();
      
      const preferences = [stakeholder2.address, stakeholder1.address];
      await expect(
        tokenStaking.connect(nonStakeholder).castRankedChoiceVote(1, preferences)
      ).to.be.revertedWith("Must be valid stakeholder to vote");
    });

    it("Should finalize election after voting period", async function () {
      const candidates = [stakeholder1.address, stakeholder2.address, stakeholder3.address];
      await tokenStaking.startStakeholderElection(candidates, "QmTestHash123");
      
      await tokenStaking.connect(stakeholder1).castRankedChoiceVote(1, [stakeholder2.address, stakeholder1.address]);
      await tokenStaking.connect(stakeholder2).castRankedChoiceVote(1, [stakeholder2.address, stakeholder3.address]);
      
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]); // 7 days + 1 second
      await ethers.provider.send("evm_mine");
      
      await tokenStaking.finalizeElection(1);
      
      const election = await tokenStaking.getElection(1);
      expect(election.isFinalized).to.be.true;
      expect(election.winner).to.equal(stakeholder2.address);
    });
  });

  describe("Slashing Mechanisms", function () {
    beforeEach(async function () {
      await roseToken.mint(stakeholder1.address, ethers.parseEther("2000"));
      await roseToken.connect(stakeholder1).approve(await tokenStaking.getAddress(), ethers.parseEther("1500"));
      await tokenStaking.connect(stakeholder1).stakeTokens(ethers.parseEther("1500"));
      
      await tokenStaking.authorizeContract(owner.address);
    });

    it("Should slash stakeholder tokens for bad behavior", async function () {
      const initialStake = await tokenStaking.getStakedAmount(stakeholder1.address);
      const slashAmount = ethers.parseEther("500");
      
      await tokenStaking.slashStakeholder(stakeholder1.address, slashAmount, "Bad behavior");
      
      const finalStake = await tokenStaking.getStakedAmount(stakeholder1.address);
      expect(finalStake).to.equal(initialStake - slashAmount);
      
      expect(await tokenStaking.isValidStakeholder(stakeholder1.address)).to.be.false;
    });

    it("Should rehabilitate slashed stakeholder", async function () {
      await tokenStaking.slashStakeholder(stakeholder1.address, ethers.parseEther("500"), "Bad behavior");
      expect(await tokenStaking.isValidStakeholder(stakeholder1.address)).to.be.false;
      
      await tokenStaking.rehabilitateStakeholder(stakeholder1.address);
      expect(await tokenStaking.isValidStakeholder(stakeholder1.address)).to.be.true;
    });

    it("Should transfer slashed tokens to DAO treasury", async function () {
      const initialTreasuryBalance = await roseToken.balanceOf(daoTreasury.address);
      const slashAmount = ethers.parseEther("500");
      
      await tokenStaking.slashStakeholder(stakeholder1.address, slashAmount, "Bad behavior");
      
      const finalTreasuryBalance = await roseToken.balanceOf(daoTreasury.address);
      expect(finalTreasuryBalance).to.equal(initialTreasuryBalance + slashAmount);
    });
  });

  describe("Integration with Governance", function () {
    it("Should return correct staked amount for voting weight calculation", async function () {
      await roseToken.mint(stakeholder1.address, ethers.parseEther("2000"));
      await roseToken.connect(stakeholder1).approve(await tokenStaking.getAddress(), ethers.parseEther("1500"));
      await tokenStaking.connect(stakeholder1).stakeTokens(ethers.parseEther("1500"));
      
      expect(await tokenStaking.getStakedAmount(stakeholder1.address)).to.equal(ethers.parseEther("1500"));
    });
  });
});
