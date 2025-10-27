const { expect } = require("chai");  
const { ethers } = require("hardhat");  
  
describe("Task Lifecycle Edge Cases", function () {
  let roseMarketplace;
  let roseToken;
  let owner;
  let customer;
  let worker;
  let stakeholder;
  let otherUser;
  let daoTreasury;

  const taskTitle = "Build a website";
  const taskDeposit = ethers.parseEther("1");
  const ipfsHash = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
  const testPrUrl = "https://github.com/test/repo/pull/123";  
  
  beforeEach(async function () {  
    [owner, customer, worker, stakeholder, otherUser, daoTreasury] = await ethers.getSigners();  
  
    const RoseMarketplace = await ethers.getContractFactory("RoseMarketplace");  
    roseMarketplace = await RoseMarketplace.deploy(daoTreasury.address);  
    await roseMarketplace.waitForDeployment();  
  
    const roseTokenAddress = await roseMarketplace.roseToken();  
    roseToken = await ethers.getContractAt("RoseToken", roseTokenAddress);  
  
    await roseMarketplace.connect(customer).claimFaucetTokens(taskDeposit * 10n);  
    await roseMarketplace.connect(stakeholder).claimFaucetTokens(taskDeposit);  
  });  
  
  it("Should not allow creating a task with zero deposit", async function() {  
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);  
      
    await expect(  
      roseMarketplace.connect(customer).createTask(taskTitle, 0, ipfsHash)  
    ).to.be.reverted;  
  });  
  
  it("Should not allow stakeholder to stake without sufficient approval", async function() {  
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);  
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);  
      
    const stakeholderDeposit = taskDeposit / 10n;  
      
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit - 1n);  
      
    await expect(  
      roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit)  
    ).to.be.reverted; // Token transfer will fail  
  });  
  
  it("Should not allow a non-minter to mint tokens", async function() {  
    await expect(  
      roseToken.connect(customer).mint(customer.address, ethers.parseEther("1"))  
    ).to.be.revertedWith("Not authorized to mint");  
  });  
  
  it("Should not allow customer to claim their own task", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

    await expect(
      roseMarketplace.connect(customer).claimTask(1)
    ).to.be.revertedWith("Customer cannot claim their own task");
  });  
  
  it("Should not allow stakeholder to be the customer", async function() {  
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);  
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);  
      
    const stakeholderDeposit = taskDeposit / 10n;  
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), stakeholderDeposit);  
      
    await expect(  
      roseMarketplace.connect(customer).stakeholderStake(1, stakeholderDeposit)  
    ).to.be.revertedWith("Customer cannot be stakeholder for their own task");  
  });  
  
  it("Should not allow wrong deposit amount for stakeholder", async function() {  
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);  
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);  
      
    const wrongDeposit = taskDeposit / 5n; // Should be taskDeposit / 10n  
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), wrongDeposit);  
      
    await expect(  
      roseMarketplace.connect(stakeholder).stakeholderStake(1, wrongDeposit)  
    ).to.be.revertedWith("Must deposit exactly 10% of task value");  
  });  
  
  it("Should not allow non-worker to mark task as completed", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

    await roseMarketplace.connect(worker).claimTask(1);

    await expect(
      roseMarketplace.connect(otherUser).markTaskCompleted(1, testPrUrl)
    ).to.be.revertedWith("Only assigned worker can mark completion");
  });

  it("Should enforce all three roles (customer, stakeholder, worker) are different addresses", async function() {
    // Create task with customer
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    // Verify customer cannot be stakeholder (already tested above, but included for completeness)
    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await expect(
      roseMarketplace.connect(customer).stakeholderStake(1, stakeholderDeposit)
    ).to.be.revertedWith("Customer cannot be stakeholder for their own task");

    // Stakeholder stakes successfully
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

    // Verify customer cannot claim task
    await expect(
      roseMarketplace.connect(customer).claimTask(1)
    ).to.be.revertedWith("Customer cannot claim their own task");

    // Verify stakeholder cannot claim task they are validating
    await expect(
      roseMarketplace.connect(stakeholder).claimTask(1)
    ).to.be.revertedWith("Stakeholder cannot claim task they are validating");

    // Worker (different from customer and stakeholder) can successfully claim
    await roseMarketplace.connect(worker).claimTask(1);

    // Verify all three roles are different addresses
    const task = await roseMarketplace.tasks(1);
    expect(task.customer).to.equal(customer.address);
    expect(task.stakeholder).to.equal(stakeholder.address);
    expect(task.worker).to.equal(worker.address);

    // Ensure all three addresses are different
    expect(task.customer).to.not.equal(task.stakeholder);
    expect(task.customer).to.not.equal(task.worker);
    expect(task.stakeholder).to.not.equal(task.worker);
  });

  it("Should not allow unclaiming task that was never claimed", async function() {
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);
    await roseMarketplace.connect(customer).createTask(taskTitle, taskDeposit, ipfsHash);

    const stakeholderDeposit = taskDeposit / 10n;
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);

    // Task is Open but no worker claimed it
    await expect(
      roseMarketplace.connect(worker).unclaimTask(1)
    ).to.be.revertedWith("Only assigned worker can unclaim");
  });
});
