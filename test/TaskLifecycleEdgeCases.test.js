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
  
  const taskDescription = "Build a website";  
  const taskDeposit = ethers.parseEther("1");  
  
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
      roseMarketplace.connect(customer).createTask(taskDescription, 0, "")  
    ).to.be.reverted;  
  });  
  
  it("Should not allow stakeholder to stake without sufficient approval", async function() {  
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);  
    await roseMarketplace.connect(customer).createTask(taskDescription, taskDeposit, "");  
      
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
    await roseMarketplace.connect(customer).createTask(taskDescription, taskDeposit, "");  
      
    const stakeholderDeposit = taskDeposit / 10n;  
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);  
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);  
      
    await expect(  
      roseMarketplace.connect(customer).claimTask(1, 5)  
    ).to.be.revertedWith("Customer cannot claim their own task");  
  });  
  
  it("Should not allow stakeholder to be the customer", async function() {  
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);  
    await roseMarketplace.connect(customer).createTask(taskDescription, taskDeposit, "");  
      
    const stakeholderDeposit = taskDeposit / 10n;  
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), stakeholderDeposit);  
      
    await expect(  
      roseMarketplace.connect(customer).stakeholderStake(1, stakeholderDeposit)  
    ).to.be.revertedWith("Customer cannot be stakeholder for their own task");  
  });  
  
  it("Should not allow wrong deposit amount for stakeholder", async function() {  
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);  
    await roseMarketplace.connect(customer).createTask(taskDescription, taskDeposit, "");  
      
    const wrongDeposit = taskDeposit / 5n; // Should be taskDeposit / 10n  
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), wrongDeposit);  
      
    await expect(  
      roseMarketplace.connect(stakeholder).stakeholderStake(1, wrongDeposit)  
    ).to.be.revertedWith("Must deposit exactly 10% of task value");  
  });  
  
  it("Should not allow non-worker to mark task as completed", async function() {  
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);  
    await roseMarketplace.connect(customer).createTask(taskDescription, taskDeposit, "");  
      
    const stakeholderDeposit = taskDeposit / 10n;  
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);  
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);  
      
    await roseMarketplace.connect(worker).claimTask(1, 5);  
      
    await expect(  
      roseMarketplace.connect(otherUser).markTaskCompleted(1)  
    ).to.be.revertedWith("Only assigned worker can mark completion");  
  });  
  
  
  it("Should not allow claiming a task with zero story points", async function() {  
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);  
    await roseMarketplace.connect(customer).createTask(taskDescription, taskDeposit, "");  
      
    const stakeholderDeposit = taskDeposit / 10n;  
    await roseToken.connect(stakeholder).approve(await roseMarketplace.getAddress(), stakeholderDeposit);  
    await roseMarketplace.connect(stakeholder).stakeholderStake(1, stakeholderDeposit);  
      
    await expect(  
      roseMarketplace.connect(worker).claimTask(1, 0)  
    ).to.be.revertedWith("Story points must be greater than zero");  
  });  
});
