const { expect } = require("chai");  
const { ethers } = require("hardhat");  
  
describe("Task Detailed Description", function () {  
  let roseMarketplace;  
  let roseToken;  
  let owner;  
  let customer;  
  let daoTreasury;  
  
  const taskDescription = "Build a website";  
  const detailedDescription = "This is a detailed description with requirements, specifications, and expected outcomes.";  
  const taskDeposit = ethers.parseEther("1");  
  
  beforeEach(async function () {  
    [owner, customer, daoTreasury] = await ethers.getSigners();  
  
    const RoseMarketplace = await ethers.getContractFactory("RoseMarketplace");  
    roseMarketplace = await RoseMarketplace.deploy(daoTreasury.address);  
    await roseMarketplace.waitForDeployment();  
  
    const roseTokenAddress = await roseMarketplace.roseToken();  
    roseToken = await ethers.getContractAt("RoseToken", roseTokenAddress);  
  
    await roseMarketplace.connect(customer).claimFaucetTokens(taskDeposit * 10n);  
    await roseToken.connect(customer).approve(await roseMarketplace.getAddress(), taskDeposit);  
  });  
  
  it("Should create a task with a detailed description", async function() {  
    await roseMarketplace.connect(customer)["createTask(string,uint256,string)"](  
      taskDescription,   
      taskDeposit,   
      detailedDescription  
    );  
  
    const task = await roseMarketplace.tasks(1);  
    expect(task.description).to.equal(taskDescription);  
    expect(task.detailedDescription).to.equal(detailedDescription);  
    expect(task.deposit).to.equal(taskDeposit);  
  });  
  
  it("Should create a task with an empty detailed description when using the simpler function", async function() {  
    await roseMarketplace.connect(customer).createTask(taskDescription, taskDeposit);  
  
    const task = await roseMarketplace.tasks(1);  
    expect(task.description).to.equal(taskDescription);  
    expect(task.detailedDescription).to.equal("");  
    expect(task.deposit).to.equal(taskDeposit);  
  });  
  
  it("Should handle empty strings for detailed description", async function() {  
    await roseMarketplace.connect(customer)["createTask(string,uint256,string)"](  
      taskDescription,   
      taskDeposit,   
      ""  
    );  
  
    const task = await roseMarketplace.tasks(1);  
    expect(task.detailedDescription).to.equal("");  
  });  
  
  it("Should handle long detailed descriptions", async function() {  
    const longDescription = "a".repeat(1000); // 1000 character description  
      
    await roseMarketplace.connect(customer)["createTask(string,uint256,string)"](  
      taskDescription,   
      taskDeposit,   
      longDescription  
    );  
  
    const task = await roseMarketplace.tasks(1);  
    expect(task.detailedDescription).to.equal(longDescription);  
  });  
});
