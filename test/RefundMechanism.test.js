const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RefundMechanism", function () {
  let roseMarketplace;
  let roseToken;
  let owner;
  let customer;
  let worker;
  let stakeholder;
  let daoTreasury;

  const taskDescription = "Build a website";
  const taskDeposit = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, customer, worker, stakeholder, daoTreasury] = await ethers.getSigners();

    const RoseMarketplace = await ethers.getContractFactory("RoseMarketplace");
    roseMarketplace = await RoseMarketplace.deploy(daoTreasury.address);
    await roseMarketplace.waitForDeployment();

    const roseTokenAddress = await roseMarketplace.roseToken();
    roseToken = await ethers.getContractAt("RoseToken", roseTokenAddress);

    await roseMarketplace.connect(customer).claimFaucetTokens(taskDeposit * 10n);
    await roseMarketplace.connect(stakeholder).claimFaucetTokens(taskDeposit);
    
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskDescription, taskDeposit);
    
    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);
    
    const storyPoints = 5; // Example story points value
    await roseMarketplace.connect(worker).claimTask(1, storyPoints);
  });

  describe("Refund Request", function () {
    it("Should allow customer to request a refund", async function () {
      await expect(roseMarketplace.connect(customer).requestRefund(1))
        .to.emit(roseMarketplace, "RefundRequested")
        .withArgs(1, customer.address);

      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(7); // TaskStatus.RefundRequested
      expect(task.refundRequested).to.equal(true);
      expect(task.customerApproval).to.equal(false);
      expect(task.workerApproval).to.equal(false);
      expect(task.stakeholderApproval).to.equal(false);
    });

    it("Should allow worker to request a refund", async function () {
      await expect(roseMarketplace.connect(worker).requestRefund(1))
        .to.emit(roseMarketplace, "RefundRequested")
        .withArgs(1, worker.address);

      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(7); // TaskStatus.RefundRequested
      expect(task.refundRequested).to.equal(true);
    });

    it("Should allow stakeholder to request a refund", async function () {
      await expect(roseMarketplace.connect(stakeholder).requestRefund(1))
        .to.emit(roseMarketplace, "RefundRequested")
        .withArgs(1, stakeholder.address);

      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(7); // TaskStatus.RefundRequested
      expect(task.refundRequested).to.equal(true);
    });

    it("Should not allow non-participants to request a refund", async function () {
      await expect(
        roseMarketplace.connect(owner).requestRefund(1)
      ).to.be.revertedWith("Only customer, worker, or stakeholder can request refund");
    });
  });

  describe("Refund Approvals", function () {
    beforeEach(async function () {
      await roseMarketplace.connect(customer).requestRefund(1);
    });

    it("Should allow customer to approve a refund", async function () {
      await roseMarketplace.connect(customer).approveRefundByCustomer(1);
      
      const task = await roseMarketplace.tasks(1);
      expect(task.customerApproval).to.equal(true);
      expect(task.status).to.equal(7); // Still RefundRequested
    });

    it("Should allow worker to approve a refund", async function () {
      await roseMarketplace.connect(worker).approveRefundByWorker(1);
      
      const task = await roseMarketplace.tasks(1);
      expect(task.workerApproval).to.equal(true);
      expect(task.status).to.equal(7); // Still RefundRequested
    });

    it("Should allow stakeholder to approve a refund", async function () {
      await roseMarketplace.connect(stakeholder).approveRefundByStakeholder(1);
      
      const task = await roseMarketplace.tasks(1);
      expect(task.stakeholderApproval).to.equal(true);
      expect(task.status).to.equal(7); // Still RefundRequested
    });

    it("Should not allow non-customer to approve as customer", async function () {
      await expect(
        roseMarketplace.connect(worker).approveRefundByCustomer(1)
      ).to.be.revertedWith("Only the customer can approve");
    });

    it("Should not allow non-worker to approve as worker", async function () {
      await expect(
        roseMarketplace.connect(customer).approveRefundByWorker(1)
      ).to.be.revertedWith("Only the worker can approve");
    });

    it("Should not allow non-stakeholder to approve as stakeholder", async function () {
      await expect(
        roseMarketplace.connect(customer).approveRefundByStakeholder(1)
      ).to.be.revertedWith("Only the stakeholder can approve");
    });
  });

  describe("Refund Processing", function () {
    beforeEach(async function () {
      await roseMarketplace.connect(customer).requestRefund(1);
    });

    it("Should process refund when all three parties approve", async function () {
      const customerBalanceBefore = await roseToken.balanceOf(customer.address);
      const stakeholderBalanceBefore = await roseToken.balanceOf(stakeholder.address);
      
      await roseMarketplace.connect(customer).approveRefundByCustomer(1);
      await roseMarketplace.connect(worker).approveRefundByWorker(1);
      
      await expect(roseMarketplace.connect(stakeholder).approveRefundByStakeholder(1))
        .to.emit(roseMarketplace, "RefundProcessed");
      
      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(5); // TaskStatus.Closed
      expect(task.deposit).to.equal(0);
      expect(task.stakeholderDeposit).to.equal(0);
      
      const customerBalanceAfter = await roseToken.balanceOf(customer.address);
      const stakeholderBalanceAfter = await roseToken.balanceOf(stakeholder.address);
      
      expect(customerBalanceAfter - customerBalanceBefore).to.equal(taskDeposit);
      
      const stakeholderDeposit = taskDeposit / 10n;
      expect(stakeholderBalanceAfter - stakeholderBalanceBefore).to.equal(stakeholderDeposit);
    });

    it("Should not process refund until all three parties approve", async function () {
      await roseMarketplace.connect(customer).approveRefundByCustomer(1);
      await roseMarketplace.connect(worker).approveRefundByWorker(1);
      
      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(7); // Still RefundRequested
      expect(task.deposit).to.equal(taskDeposit); // Deposit should still be in contract
    });
  });
});
