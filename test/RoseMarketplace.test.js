const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RoseMarketplace", function () {
  let roseMarketplace;
  let roseToken;
  let owner;
  let customer;
  let worker;
  let stakeholder;
  let daoTreasury;
  let burnAddress;

  const BASE_REWARD = ethers.parseEther("100");
  const WORKER_SHARE = 50;
  const STAKEHOLDER_SHARE = 20;
  const TREASURY_SHARE = 20;
  const BURN_SHARE = 10;
  const SHARE_DENOMINATOR = 100;

  beforeEach(async function () {
    [owner, customer, worker, stakeholder, daoTreasury] = await ethers.getSigners();
    burnAddress = "0x000000000000000000000000000000000000dEaD";

    const RoseMarketplace = await ethers.getContractFactory("RoseMarketplace");
    roseMarketplace = await RoseMarketplace.deploy(daoTreasury.address);
    await roseMarketplace.waitForDeployment();

    const roseTokenAddress = await roseMarketplace.roseToken();
    roseToken = await ethers.getContractAt("RoseToken", roseTokenAddress);
  });

  describe("Deployment", function () {
    it("Should set the correct DAO treasury address", async function () {
      expect(await roseMarketplace.daoTreasury()).to.equal(daoTreasury.address);
    });

    it("Should deploy RoseToken with marketplace as minter", async function () {
      expect(await roseToken.minter()).to.equal(await roseMarketplace.getAddress());
    });

    it("Should start with zero task counter", async function () {
      expect(await roseMarketplace.taskCounter()).to.equal(0);
    });
  });

  describe("Task Creation", function () {
    const taskDescription = "Build a website";
    const taskDeposit = ethers.parseEther("1");

    it("Should allow customers to create tasks", async function () {
      await expect(
        roseMarketplace.connect(customer).createTask(taskDescription, stakeholder.address, {
          value: taskDeposit
        })
      )
        .to.emit(roseMarketplace, "TaskCreated")
        .withArgs(1, customer.address, stakeholder.address, taskDeposit);

      expect(await roseMarketplace.taskCounter()).to.equal(1);

      const task = await roseMarketplace.tasks(1);
      expect(task.customer).to.equal(customer.address);
      expect(task.stakeholder).to.equal(stakeholder.address);
      expect(task.deposit).to.equal(taskDeposit);
      expect(task.description).to.equal(taskDescription);
      expect(task.status).to.equal(0); // TaskStatus.Open
      expect(task.customerApproval).to.equal(false);
      expect(task.stakeholderApproval).to.equal(false);
    });

    it("Should revert if deposit is zero", async function () {
      await expect(
        roseMarketplace.connect(customer).createTask(taskDescription, stakeholder.address, {
          value: 0
        })
      ).to.be.revertedWith("Must deposit some ETH as payment");
    });

    it("Should revert if stakeholder is zero address", async function () {
      await expect(
        roseMarketplace.connect(customer).createTask(taskDescription, ethers.ZeroAddress, {
          value: taskDeposit
        })
      ).to.be.revertedWith("Stakeholder cannot be zero address");
    });
  });

  describe("Task Lifecycle", function () {
    const taskDescription = "Build a website";
    const taskDeposit = ethers.parseEther("1");

    beforeEach(async function () {
      await roseMarketplace.connect(customer).createTask(taskDescription, stakeholder.address, {
        value: taskDeposit
      });
    });

    it("Should allow workers to claim tasks", async function () {
      await expect(roseMarketplace.connect(worker).claimTask(1))
        .to.emit(roseMarketplace, "TaskClaimed")
        .withArgs(1, worker.address);

      const task = await roseMarketplace.tasks(1);
      expect(task.worker).to.equal(worker.address);
      expect(task.status).to.equal(1); // TaskStatus.InProgress
    });

    it("Should not allow customers to claim their own tasks", async function () {
      await expect(
        roseMarketplace.connect(customer).claimTask(1)
      ).to.be.revertedWith("Customer cannot claim their own task");
    });

    it("Should allow workers to mark tasks as completed", async function () {
      await roseMarketplace.connect(worker).claimTask(1);

      await expect(roseMarketplace.connect(worker).markTaskCompleted(1))
        .to.emit(roseMarketplace, "TaskCompleted")
        .withArgs(1);

      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(2); // TaskStatus.Completed
    });

    it("Should allow customer and stakeholder approvals and mark task ready for payment", async function () {
      await roseMarketplace.connect(worker).claimTask(1);
      await roseMarketplace.connect(worker).markTaskCompleted(1);

      await roseMarketplace.connect(customer).approveCompletionByCustomer(1);
      
      let task = await roseMarketplace.tasks(1);
      expect(task.customerApproval).to.equal(true);
      expect(task.status).to.equal(2); // Still Completed, not Closed yet

      await expect(roseMarketplace.connect(stakeholder).approveCompletionByStakeholder(1))
        .to.emit(roseMarketplace, "TaskReadyForPayment")
        .withArgs(1, worker.address, taskDeposit);

      task = await roseMarketplace.tasks(1);
      expect(task.stakeholderApproval).to.equal(true);
      expect(task.status).to.equal(5); // TaskStatus.ApprovedPendingPayment
      expect(task.deposit).to.equal(taskDeposit); // Deposit should still be in contract
    });

    it("Should allow worker to accept payment after approvals", async function () {
      await roseMarketplace.connect(worker).claimTask(1);
      await roseMarketplace.connect(worker).markTaskCompleted(1);
      await roseMarketplace.connect(customer).approveCompletionByCustomer(1);
      await roseMarketplace.connect(stakeholder).approveCompletionByStakeholder(1);
      
      let task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(5); // TaskStatus.ApprovedPendingPayment
      
      await expect(roseMarketplace.connect(worker).acceptPayment(1))
        .to.emit(roseMarketplace, "TaskClosed")
        .withArgs(1)
        .and.to.emit(roseMarketplace, "PaymentReleased")
        .withArgs(1, worker.address, taskDeposit);
        
      task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(4); // TaskStatus.Closed
      expect(task.deposit).to.equal(0); // Deposit should be transferred to worker
    });

    it("Should mint tokens when worker accepts payment", async function () {
      await roseMarketplace.connect(worker).claimTask(1);
      await roseMarketplace.connect(worker).markTaskCompleted(1);
      await roseMarketplace.connect(customer).approveCompletionByCustomer(1);
      await roseMarketplace.connect(stakeholder).approveCompletionByStakeholder(1);
      await roseMarketplace.connect(worker).acceptPayment(1);

      const workerAmount = (BASE_REWARD * BigInt(WORKER_SHARE)) / BigInt(SHARE_DENOMINATOR);
      const stakeholderAmount = (BASE_REWARD * BigInt(STAKEHOLDER_SHARE)) / BigInt(SHARE_DENOMINATOR);
      const treasuryAmount = (BASE_REWARD * BigInt(TREASURY_SHARE)) / BigInt(SHARE_DENOMINATOR);
      const burnAmount = (BASE_REWARD * BigInt(BURN_SHARE)) / BigInt(SHARE_DENOMINATOR);

      expect(await roseToken.balanceOf(worker.address)).to.equal(workerAmount);
      expect(await roseToken.balanceOf(stakeholder.address)).to.equal(stakeholderAmount);
      expect(await roseToken.balanceOf(daoTreasury.address)).to.equal(treasuryAmount);
      expect(await roseToken.balanceOf(burnAddress)).to.equal(burnAmount);
    });

    it("Should handle disputes", async function () {
      await roseMarketplace.connect(worker).claimTask(1);
      await roseMarketplace.connect(worker).markTaskCompleted(1);

      await expect(roseMarketplace.connect(customer).disputeTask(1))
        .to.emit(roseMarketplace, "TaskDisputed")
        .withArgs(1);

      const task = await roseMarketplace.tasks(1);
      expect(task.status).to.equal(3); // TaskStatus.Disputed

      await expect(roseMarketplace.connect(stakeholder).resolveDispute(1, false))
        .to.emit(roseMarketplace, "TaskClosed")
        .withArgs(1);

      const workerAmount = (BASE_REWARD * BigInt(WORKER_SHARE)) / BigInt(SHARE_DENOMINATOR);
      expect(await roseToken.balanceOf(worker.address)).to.equal(workerAmount);
    });
  });
});
