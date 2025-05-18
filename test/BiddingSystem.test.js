const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Bidding System", function () {
  let roseMarketplace;
  let roseToken;
  let owner;
  let customer;
  let worker1;
  let worker2;
  let worker3;
  let stakeholder;
  let daoTreasury;

  const BASE_REWARD = ethers.parseEther("100");
  const WORKER_SHARE = 60;
  const STAKEHOLDER_SHARE = 20;
  const TREASURY_SHARE = 20;
  const SHARE_DENOMINATOR = 100;

  const taskDescription = "Build a website";
  const taskDeposit = ethers.parseEther("1");
  const stakeholderDeposit = taskDeposit / 10n;
  const bidAmount = ethers.parseEther("0.9"); // Worker willing to accept less than deposit
  const minStake = ethers.parseEther("0.05"); // Minimum stake required for bidding
  const biddingDuration = 7 * 24 * 60 * 60; // 7 days in seconds

  beforeEach(async function () {
    [owner, customer, worker1, worker2, worker3, stakeholder, daoTreasury] = await ethers.getSigners();

    const RoseMarketplace = await ethers.getContractFactory("RoseMarketplace");
    roseMarketplace = await RoseMarketplace.deploy(daoTreasury.address);
    await roseMarketplace.waitForDeployment();

    const roseTokenAddress = await roseMarketplace.roseToken();
    roseToken = await ethers.getContractAt("RoseToken", roseTokenAddress);

    await roseMarketplace.connect(customer).claimFaucetTokens(taskDeposit * 10n);
    await roseMarketplace.connect(stakeholder).claimFaucetTokens(taskDeposit * 10n);
    await roseMarketplace.connect(worker1).claimFaucetTokens(taskDeposit);
    await roseMarketplace.connect(worker2).claimFaucetTokens(taskDeposit);
    await roseMarketplace.connect(worker3).claimFaucetTokens(taskDeposit);

    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskDescription, taskDeposit, "");

    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);
  });

  describe("Bidding Phase Initialization", function () {
    it("Should allow stakeholder to start bidding phase", async function () {
      await expect(
        roseMarketplace.connect(stakeholder).startBiddingPhase(1, biddingDuration, minStake)
      )
        .to.emit(roseMarketplace, "BiddingStarted")
        .withArgs(1, await ethers.provider.getBlock("latest").then(b => b.timestamp + 1), 
                 await ethers.provider.getBlock("latest").then(b => b.timestamp + 1 + biddingDuration), 
                 minStake);

      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(2); // TaskStatus.Bidding
    });

    it("Should allow customer to start bidding phase", async function () {
      await expect(
        roseMarketplace.connect(customer).startBiddingPhase(1, biddingDuration, minStake)
      ).to.emit(roseMarketplace, "BiddingStarted");
    });

    it("Should not allow non-stakeholder/customer to start bidding", async function () {
      await expect(
        roseMarketplace.connect(worker1).startBiddingPhase(1, biddingDuration, minStake)
      ).to.be.revertedWith("Only stakeholder or customer can start bidding");
    });

    it("Should enforce bidding duration limits", async function () {
      await expect(
        roseMarketplace.connect(stakeholder).startBiddingPhase(1, 60, minStake)
      ).to.be.revertedWith("Bidding duration must be between 1 and 30 days");

      await expect(
        roseMarketplace.connect(stakeholder).startBiddingPhase(1, 31 * 24 * 60 * 60, minStake)
      ).to.be.revertedWith("Bidding duration must be between 1 and 30 days");
    });
  });

  describe("Bid Placement", function () {
    beforeEach(async function () {
      await roseMarketplace.connect(stakeholder).startBiddingPhase(1, biddingDuration, minStake);
    });

    it("Should allow workers to place bids", async function () {
      await roseToken.connect(worker1).approve(await roseMarketplace.getAddress(), minStake);
      
      await expect(
        roseMarketplace.connect(worker1).placeBid(
          1, bidAmount, 14 * 24 * 60 * 60, 5, "ipfs://portfolio", "ipfs://implementation"
        )
      )
        .to.emit(roseMarketplace, "BidPlaced")
        .withArgs(1, worker1.address, bidAmount, 5, await roseMarketplace.calculateBidReputationScore(worker1.address));

      const bids = await roseMarketplace.getTaskBids(1);
      expect(bids.length).to.equal(1);
      expect(bids[0].worker).to.equal(worker1.address);
      expect(bids[0].bidAmount).to.equal(bidAmount);
      expect(bids[0].stakingAmount).to.equal(minStake);
      expect(bids[0].status).to.equal(0); // BidStatus.Active
    });

    it("Should not allow customer to place bids", async function () {
      await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), minStake);
      
      await expect(
        roseMarketplace.connect(customer).placeBid(
          1, bidAmount, 14 * 24 * 60 * 60, 5, "ipfs://portfolio", "ipfs://implementation"
        )
      ).to.be.revertedWith("Customer cannot bid on own task");
    });

    it("Should not allow stakeholder to place bids", async function () {
      await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), minStake);
      
      await expect(
        roseMarketplace.connect(stakeholder).placeBid(
          1, bidAmount, 14 * 24 * 60 * 60, 5, "ipfs://portfolio", "ipfs://implementation"
        )
      ).to.be.revertedWith("Stakeholder cannot bid on this task");
    });

    it("Should not allow duplicate bids from the same worker", async function () {
      await roseToken.connect(worker1).approve(await roseMarketplace.getAddress(), minStake * 2n);
      
      await roseMarketplace.connect(worker1).placeBid(
        1, bidAmount, 14 * 24 * 60 * 60, 5, "ipfs://portfolio", "ipfs://implementation"
      );
      
      await expect(
        roseMarketplace.connect(worker1).placeBid(
          1, bidAmount, 14 * 24 * 60 * 60, 5, "ipfs://portfolio", "ipfs://implementation"
        )
      ).to.be.revertedWith("Worker has already placed a bid");
    });

    it("Should require stake transfer for bid placement", async function () {
      await expect(
        roseMarketplace.connect(worker1).placeBid(
          1, bidAmount, 14 * 24 * 60 * 60, 5, "ipfs://portfolio", "ipfs://implementation"
        )
      ).to.be.revertedWith("Stake transfer failed");
    });
  });

  describe("Bid Withdrawal", function () {
    beforeEach(async function () {
      await roseMarketplace.connect(stakeholder).startBiddingPhase(1, biddingDuration, minStake);
      
      await roseToken.connect(worker1).approve(await roseMarketplace.getAddress(), minStake);
      await roseMarketplace.connect(worker1).placeBid(
        1, bidAmount, 14 * 24 * 60 * 60, 5, "ipfs://portfolio", "ipfs://implementation"
      );
    });

    it("Should allow workers to withdraw their bids", async function () {
      const workerBalanceBefore = await roseToken.balanceOf(worker1.address);
      
      await expect(
        roseMarketplace.connect(worker1).withdrawBid(1)
      )
        .to.emit(roseMarketplace, "BidWithdrawn")
        .withArgs(1, worker1.address);

      const bids = await roseMarketplace.getTaskBids(1);
      expect(bids[0].status).to.equal(4); // BidStatus.Withdrawn
      expect(bids[0].stakingAmount).to.equal(0);
      
      const workerBalanceAfter = await roseToken.balanceOf(worker1.address);
      expect(workerBalanceAfter - workerBalanceBefore).to.equal(minStake);
    });

    it("Should not allow non-bidders to withdraw bids", async function () {
      await expect(
        roseMarketplace.connect(worker2).withdrawBid(1)
      ).to.be.revertedWith("Worker has not placed a bid");
    });

    it("Should not allow withdrawal after bidding period ends", async function () {
      await ethers.provider.send("evm_increaseTime", [biddingDuration + 1]);
      await ethers.provider.send("evm_mine");
      
      await roseMarketplace.connect(customer).selectShortlist(1, [0]);
      
      await expect(
        roseMarketplace.connect(worker1).withdrawBid(1)
      ).to.be.revertedWith("Task must be in bidding phase");
    });
  });

  describe("Shortlist Selection", function () {
    beforeEach(async function () {
      await roseMarketplace.connect(stakeholder).startBiddingPhase(1, biddingDuration, minStake);
      
      await roseToken.connect(worker1).approve(await roseMarketplace.getAddress(), minStake);
      await roseMarketplace.connect(worker1).placeBid(
        1, bidAmount, 14 * 24 * 60 * 60, 5, "ipfs://portfolio1", "ipfs://implementation1"
      );
      
      await roseToken.connect(worker2).approve(await roseMarketplace.getAddress(), minStake);
      await roseMarketplace.connect(worker2).placeBid(
        1, bidAmount - ethers.parseEther("0.1"), 10 * 24 * 60 * 60, 4, "ipfs://portfolio2", "ipfs://implementation2"
      );
      
      await roseToken.connect(worker3).approve(await roseMarketplace.getAddress(), minStake);
      await roseMarketplace.connect(worker3).placeBid(
        1, bidAmount + ethers.parseEther("0.1"), 20 * 24 * 60 * 60, 6, "ipfs://portfolio3", "ipfs://implementation3"
      );
      
      await ethers.provider.send("evm_increaseTime", [biddingDuration + 1]);
      await ethers.provider.send("evm_mine");
    });

    it("Should allow customer to select shortlist", async function () {
      await expect(
        roseMarketplace.connect(customer).selectShortlist(1, [0, 1])
      )
        .to.emit(roseMarketplace, "ShortlistSelected")
        .withArgs(1, [0, 1]);

      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(3); // TaskStatus.ShortlistSelected
      
      const bids = await roseMarketplace.getTaskBids(1);
      expect(bids[0].status).to.equal(1); // BidStatus.Shortlisted
      expect(bids[1].status).to.equal(1); // BidStatus.Shortlisted
      expect(bids[2].status).to.equal(0); // BidStatus.Active (not shortlisted)
    });

    it("Should not allow non-customer to select shortlist", async function () {
      await expect(
        roseMarketplace.connect(worker1).selectShortlist(1, [0, 1])
      ).to.be.revertedWith("Only customer can select shortlist");
    });

    it("Should enforce shortlist size limits", async function () {
      await expect(
        roseMarketplace.connect(customer).selectShortlist(1, [])
      ).to.be.revertedWith("Must select 1-5 bids");
      
    });

    it("Should validate bid indices", async function () {
      await expect(
        roseMarketplace.connect(customer).selectShortlist(1, [0, 10])
      ).to.be.revertedWith("Invalid bid index");
    });
  });

  describe("Worker Selection", function () {
    beforeEach(async function () {
      await roseMarketplace.connect(stakeholder).startBiddingPhase(1, biddingDuration, minStake);
      
      await roseToken.connect(worker1).approve(await roseMarketplace.getAddress(), minStake);
      await roseMarketplace.connect(worker1).placeBid(
        1, bidAmount, 14 * 24 * 60 * 60, 5, "ipfs://portfolio1", "ipfs://implementation1"
      );
      
      await roseToken.connect(worker2).approve(await roseMarketplace.getAddress(), minStake);
      await roseMarketplace.connect(worker2).placeBid(
        1, bidAmount - ethers.parseEther("0.1"), 10 * 24 * 60 * 60, 4, "ipfs://portfolio2", "ipfs://implementation2"
      );
      
      await ethers.provider.send("evm_increaseTime", [biddingDuration + 1]);
      await ethers.provider.send("evm_mine");
      
      await roseMarketplace.connect(customer).selectShortlist(1, [0, 1]);
    });

    it("Should allow stakeholder to select final worker", async function () {
      const worker2BalanceBefore = await roseToken.balanceOf(worker2.address);
      
      await expect(
        roseMarketplace.connect(stakeholder).finalizeWorkerSelection(1, 1)
      )
        .to.emit(roseMarketplace, "WorkerSelected")
        .withArgs(1, worker2.address, bidAmount - ethers.parseEther("0.1"));

      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(4); // TaskStatus.InProgress
      expect(task.worker).to.equal(worker2.address);
      expect(task.storyPoints).to.equal(4);
      
      const bids = await roseMarketplace.getTaskBids(1);
      expect(bids[0].status).to.equal(3); // BidStatus.Rejected
      expect(bids[1].status).to.equal(2); // BidStatus.Selected
      
      const worker1BalanceAfter = await roseToken.balanceOf(worker1.address);
      expect(worker1BalanceAfter).to.equal(await roseToken.balanceOf(worker1.address) + minStake);
      
      const worker2BalanceAfter = await roseToken.balanceOf(worker2.address);
      expect(worker2BalanceAfter).to.equal(worker2BalanceBefore);
    });

    it("Should not allow non-stakeholder to select worker", async function () {
      await expect(
        roseMarketplace.connect(customer).finalizeWorkerSelection(1, 0)
      ).to.be.revertedWith("Only stakeholder can finalize selection");
    });

    it("Should only allow selection from shortlisted bids", async function () {
      await expect(
        roseMarketplace.connect(stakeholder).finalizeWorkerSelection(1, 2)
      ).to.be.revertedWith("Invalid bid index");
    });
  });

  describe("Bidding Period Extension", function () {
    beforeEach(async function () {
      await roseMarketplace.connect(stakeholder).startBiddingPhase(1, biddingDuration, minStake);
    });

    it("Should allow customer to extend bidding period", async function () {
      const additionalTime = 7 * 24 * 60 * 60; // 7 more days
      
      const bidding = await roseMarketplace.taskBidding(1);
      const originalEndTime = bidding.endTime;
      
      await expect(
        roseMarketplace.connect(customer).extendBiddingPeriod(1, additionalTime)
      )
        .to.emit(roseMarketplace, "BiddingPeriodExtended")
        .withArgs(1, originalEndTime + BigInt(additionalTime));
      
      const biddingAfter = await roseMarketplace.taskBidding(1);
      expect(biddingAfter.endTime).to.equal(originalEndTime + BigInt(additionalTime));
    });

    it("Should allow stakeholder to extend bidding period", async function () {
      const additionalTime = 7 * 24 * 60 * 60; // 7 more days
      
      await expect(
        roseMarketplace.connect(stakeholder).extendBiddingPeriod(1, additionalTime)
      ).to.emit(roseMarketplace, "BiddingPeriodExtended");
    });

    it("Should not allow non-customer/stakeholder to extend period", async function () {
      const additionalTime = 7 * 24 * 60 * 60; // 7 more days
      
      await expect(
        roseMarketplace.connect(worker1).extendBiddingPeriod(1, additionalTime)
      ).to.be.revertedWith("Only customer or stakeholder can extend");
    });

    it("Should enforce extension time limits", async function () {
      const tooLongExtension = 15 * 24 * 60 * 60; // 15 days
      
      await expect(
        roseMarketplace.connect(customer).extendBiddingPeriod(1, tooLongExtension)
      ).to.be.revertedWith("Cannot extend more than 14 days");
    });

    it("Should not allow extension after bidding period ends", async function () {
      await ethers.provider.send("evm_increaseTime", [biddingDuration + 1]);
      await ethers.provider.send("evm_mine");
      
      await expect(
        roseMarketplace.connect(customer).extendBiddingPeriod(1, 24 * 60 * 60)
      ).to.be.revertedWith("Bidding period already ended");
    });
  });

  describe("Bidding Dispute Handling", function () {
    beforeEach(async function () {
      await roseMarketplace.connect(stakeholder).startBiddingPhase(1, biddingDuration, minStake);
      
      await roseToken.connect(worker1).approve(await roseMarketplace.getAddress(), minStake);
      await roseMarketplace.connect(worker1).placeBid(
        1, bidAmount, 14 * 24 * 60 * 60, 5, "ipfs://portfolio1", "ipfs://implementation1"
      );
      
      await roseToken.connect(worker2).approve(await roseMarketplace.getAddress(), minStake);
      await roseMarketplace.connect(worker2).placeBid(
        1, bidAmount - ethers.parseEther("0.1"), 10 * 24 * 60 * 60, 4, "ipfs://portfolio2", "ipfs://implementation2"
      );
    });

    it("Should allow stakeholder to restart bidding", async function () {
      const worker1BalanceBefore = await roseToken.balanceOf(worker1.address);
      const worker2BalanceBefore = await roseToken.balanceOf(worker2.address);
      
      await expect(
        roseMarketplace.connect(stakeholder).handleBiddingDispute(1, 1)
      )
        .to.emit(roseMarketplace, "BiddingRestarted")
        .withArgs(1);
      
      const worker1BalanceAfter = await roseToken.balanceOf(worker1.address);
      const worker2BalanceAfter = await roseToken.balanceOf(worker2.address);
      
      expect(worker1BalanceAfter - worker1BalanceBefore).to.equal(minStake);
      expect(worker2BalanceAfter - worker2BalanceBefore).to.equal(minStake);
      
      const bidding = await roseMarketplace.taskBidding(1);
      expect(bidding.isClosed).to.equal(false);
      
      const bids = await roseMarketplace.getTaskBids(1);
      expect(bids.length).to.equal(0);
    });

    it("Should allow stakeholder to cancel task", async function () {
      const customerBalanceBefore = await roseToken.balanceOf(customer.address);
      const stakeholderBalanceBefore = await roseToken.balanceOf(stakeholder.address);
      
      await expect(
        roseMarketplace.connect(stakeholder).handleBiddingDispute(1, 2)
      )
        .to.emit(roseMarketplace, "RefundProcessed");
      
      const customerBalanceAfter = await roseToken.balanceOf(customer.address);
      const stakeholderBalanceAfter = await roseToken.balanceOf(stakeholder.address);
      
      expect(customerBalanceAfter - customerBalanceBefore).to.equal(taskDeposit);
      expect(stakeholderBalanceAfter - stakeholderBalanceBefore).to.equal(stakeholderDeposit);
      
      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(5); // TaskStatus.Closed
    });

    it("Should not allow non-stakeholder to handle disputes", async function () {
      await expect(
        roseMarketplace.connect(customer).handleBiddingDispute(1, 1)
      ).to.be.revertedWith("Only stakeholder can resolve disputes");
    });

    it("Should only work during bidding or shortlist phases", async function () {
      await ethers.provider.send("evm_increaseTime", [biddingDuration + 1]);
      await ethers.provider.send("evm_mine");
      
      await roseMarketplace.connect(customer).selectShortlist(1, [0]);
      await roseMarketplace.connect(stakeholder).finalizeWorkerSelection(1, 0);
      
      await expect(
        roseMarketplace.connect(stakeholder).handleBiddingDispute(1, 1)
      ).to.be.revertedWith("Task must be in bidding or shortlist phase");
    });
  });

  describe("Complete Bidding Workflow", function () {
    it("Should handle the complete bidding workflow", async function () {
      await roseMarketplace.connect(stakeholder).startBiddingPhase(1, biddingDuration, minStake);
      
      await roseToken.connect(worker1).approve(await roseMarketplace.getAddress(), minStake);
      await roseMarketplace.connect(worker1).placeBid(
        1, bidAmount, 14 * 24 * 60 * 60, 5, "ipfs://portfolio1", "ipfs://implementation1"
      );
      
      await roseToken.connect(worker2).approve(await roseMarketplace.getAddress(), minStake);
      await roseMarketplace.connect(worker2).placeBid(
        1, bidAmount - ethers.parseEther("0.1"), 10 * 24 * 60 * 60, 4, "ipfs://portfolio2", "ipfs://implementation2"
      );
      
      await ethers.provider.send("evm_increaseTime", [biddingDuration + 1]);
      await ethers.provider.send("evm_mine");
      
      await roseMarketplace.connect(customer).selectShortlist(1, [0, 1]);
      
      await roseMarketplace.connect(stakeholder).finalizeWorkerSelection(1, 0);
      
      await roseMarketplace.connect(worker1).markTaskCompleted(1);
      
      await roseMarketplace.connect(customer).approveCompletionByCustomer(1);
      await roseMarketplace.connect(stakeholder).approveCompletionByStakeholder(1);
      
      const workerBalanceBefore = await roseToken.balanceOf(worker1.address);
      await roseMarketplace.connect(worker1).acceptPayment(1);
      
      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(5); // TaskStatus.Closed
      
      const workerReward = (BASE_REWARD * BigInt(WORKER_SHARE)) / BigInt(SHARE_DENOMINATOR);
      const workerBalanceAfter = await roseToken.balanceOf(worker1.address);
      
      expect(workerBalanceAfter - workerBalanceBefore).to.equal(taskDeposit + workerReward);
    });
  });
});
