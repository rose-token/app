const { expect } = require("chai");  
const { ethers } = require("hardhat");  
  
describe("Token Faucet", function () {  
  let roseMarketplace;  
  let roseToken;  
  let owner;  
  let user1;  
  let user2;  
  let daoTreasury;  
  
  beforeEach(async function () {  
    [owner, user1, user2, daoTreasury] = await ethers.getSigners();  
  
    const RoseMarketplace = await ethers.getContractFactory("RoseMarketplace");  
    roseMarketplace = await RoseMarketplace.deploy(daoTreasury.address);  
    await roseMarketplace.waitForDeployment();  
  
    const roseTokenAddress = await roseMarketplace.roseToken();  
    roseToken = await ethers.getContractAt("RoseToken", roseTokenAddress);  
  });  
  
  it("Should allow users to claim tokens from the faucet", async function() {  
    const claimAmount = ethers.parseEther("10");  
      
    const initialBalance = await roseToken.balanceOf(user1.address);  
      
    await expect(roseMarketplace.connect(user1).claimFaucetTokens(claimAmount))  
      .to.emit(roseMarketplace, "FaucetTokensClaimed")  
      .withArgs(user1.address, claimAmount);  
        
    const finalBalance = await roseToken.balanceOf(user1.address);  
    expect(finalBalance - initialBalance).to.equal(claimAmount);  
  });  
  
  it("Should allow multiple users to claim tokens", async function() {  
    const claimAmount = ethers.parseEther("5");  
      
    await roseMarketplace.connect(user1).claimFaucetTokens(claimAmount);  
    await roseMarketplace.connect(user2).claimFaucetTokens(claimAmount);  
      
    expect(await roseToken.balanceOf(user1.address)).to.equal(claimAmount);  
    expect(await roseToken.balanceOf(user2.address)).to.equal(claimAmount);  
  });  
  
  it("Should allow users to claim multiple times", async function() {  
    const claimAmount = ethers.parseEther("5");  
      
    await roseMarketplace.connect(user1).claimFaucetTokens(claimAmount);  
    await roseMarketplace.connect(user1).claimFaucetTokens(claimAmount);  
      
    expect(await roseToken.balanceOf(user1.address)).to.equal(claimAmount * 2n);  
  });  
  
  it("Should revert if claiming more than the maximum allowed", async function() {  
    const maxAmount = ethers.parseEther("100");  
    const tooMuch = maxAmount + 1n;  
      
    await expect(  
      roseMarketplace.connect(user1).claimFaucetTokens(tooMuch)  
    ).to.be.revertedWith("Cannot claim more than 100 ROSE tokens at once");  
  });  
  
  it("Should allow claiming the maximum amount exactly", async function() {  
    const maxAmount = ethers.parseEther("100");  
      
    await roseMarketplace.connect(user1).claimFaucetTokens(maxAmount);  
      
    expect(await roseToken.balanceOf(user1.address)).to.equal(maxAmount);  
  });  
});
