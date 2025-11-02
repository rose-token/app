const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Task Detailed Description", function () {
  let roseMarketplace;
  let roseToken;
  let customer;
  let worker;
  let stakeholder;
  let otherUser;
  let daoTreasury;

  const taskTitle = "Build a website";
  const taskDeposit = ethers.parseEther("1");
  const ipfsHash = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"; // Example IPFS hash

  beforeEach(async function () {
    [customer, worker, stakeholder, otherUser, daoTreasury] = await ethers.getSigners();

    const RoseMarketplace = await ethers.getContractFactory("RoseMarketplace");
    roseMarketplace = await RoseMarketplace.deploy(daoTreasury.address);
    await roseMarketplace.waitForDeployment();

    const roseTokenAddress = await roseMarketplace.roseToken();
    roseToken = await ethers.getContractAt("RoseToken", roseTokenAddress);

    // Transfer tokens from DAO treasury (which received 10,000 ROSE on deployment)
    await roseToken.connect(daoTreasury).transfer(customer.address, taskDeposit * 10n);
  });

  it("Should create a task with mandatory IPFS hash", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

    await expect(
      roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash)
    )
      .to.emit(roseMarketplace, "TaskCreated")
      .withArgs(1, customer.address, taskDeposit);

    const task = await roseMarketplace.tasks(1);
    expect(task.title).to.equal(taskTitle);
    expect(task.detailedDescriptionHash).to.equal(ipfsHash);
  });

  it("Should revert if detailed description hash is empty", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

    await expect(
      roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, "")
    ).to.be.revertedWith("Detailed description hash is required");
  });

  it("Should revert if title is empty", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);

    await expect(
      roseMarketplace.connect(customer).createTask("", taskDeposit, ipfsHash)
    ).to.be.revertedWith("Title cannot be empty");
  });

  it("Should return true for isTaskParticipant when customer", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    expect(await roseMarketplace.connect(customer).isTaskParticipant(1)).to.equal(true);
  });

  it("Should return true for isTaskParticipant when stakeholder", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    await roseToken.connect(daoTreasury).transfer(stakeholder.address, taskDeposit);
    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

    expect(await roseMarketplace.connect(stakeholder).isTaskParticipant(1)).to.equal(true);
  });

  it("Should return true for isTaskParticipant when worker", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    await roseToken.connect(daoTreasury).transfer(stakeholder.address, taskDeposit);
    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

    await roseMarketplace.connect(worker).claimTask(1);

    expect(await roseMarketplace.connect(worker).isTaskParticipant(1)).to.equal(true);
  });

  it("Should return false for isTaskParticipant when not a participant", async function () {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    expect(await roseMarketplace.connect(otherUser).isTaskParticipant(1)).to.equal(false);
  });
});
