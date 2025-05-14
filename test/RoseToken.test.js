const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RoseToken", function () {
  let roseToken;
  let owner;
  let minter;
  let user1;
  let user2;

  beforeEach(async function () {
    [owner, minter, user1, user2] = await ethers.getSigners();
    
    const RoseToken = await ethers.getContractFactory("RoseToken");
    roseToken = await RoseToken.deploy(minter.address);
    await roseToken.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct token name and symbol", async function () {
      expect(await roseToken.name()).to.equal("Rose Token");
      expect(await roseToken.symbol()).to.equal("ROSE");
      expect(await roseToken.decimals()).to.equal(18);
    });

    it("Should set the correct minter", async function () {
      expect(await roseToken.minter()).to.equal(minter.address);
    });

    it("Should start with zero total supply", async function () {
      expect(await roseToken.totalSupply()).to.equal(0);
    });
  });

  describe("Minting", function () {
    it("Should allow minter to mint tokens", async function () {
      const mintAmount = ethers.parseEther("100");
      
      await roseToken.connect(minter).mint(user1.address, mintAmount);
      
      expect(await roseToken.totalSupply()).to.equal(mintAmount);
      expect(await roseToken.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should revert if non-minter tries to mint tokens", async function () {
      const mintAmount = ethers.parseEther("100");
      
      await expect(
        roseToken.connect(user1).mint(user2.address, mintAmount)
      ).to.be.revertedWith("Not authorized to mint");
    });

    it("Should revert if minting to zero address", async function () {
      const mintAmount = ethers.parseEther("100");
      
      await expect(
        roseToken.connect(minter).mint(ethers.ZeroAddress, mintAmount)
      ).to.be.revertedWith("Cannot mint to zero address");
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      const mintAmount = ethers.parseEther("100");
      await roseToken.connect(minter).mint(user1.address, mintAmount);
    });

    it("Should allow users to transfer tokens", async function () {
      const transferAmount = ethers.parseEther("50");
      
      await roseToken.connect(user1).transfer(user2.address, transferAmount);
      
      expect(await roseToken.balanceOf(user1.address)).to.equal(ethers.parseEther("50"));
      expect(await roseToken.balanceOf(user2.address)).to.equal(transferAmount);
    });

    it("Should revert if transferring more than balance", async function () {
      const transferAmount = ethers.parseEther("150"); // More than user1 has
      
      await expect(
        roseToken.connect(user1).transfer(user2.address, transferAmount)
      ).to.be.revertedWith("Insufficient balance");
    });

    it("Should revert if transferring to zero address", async function () {
      const transferAmount = ethers.parseEther("50");
      
      await expect(
        roseToken.connect(user1).transfer(ethers.ZeroAddress, transferAmount)
      ).to.be.revertedWith("Cannot transfer to zero address");
    });
  });

  describe("Allowances", function () {
    beforeEach(async function () {
      const mintAmount = ethers.parseEther("100");
      await roseToken.connect(minter).mint(user1.address, mintAmount);
    });

    it("Should allow users to approve spending", async function () {
      const approveAmount = ethers.parseEther("50");
      
      await roseToken.connect(user1).approve(user2.address, approveAmount);
      
      expect(await roseToken.allowance(user1.address, user2.address)).to.equal(approveAmount);
    });

    it("Should allow transferFrom with sufficient allowance", async function () {
      const approveAmount = ethers.parseEther("50");
      await roseToken.connect(user1).approve(user2.address, approveAmount);
      
      await roseToken.connect(user2).transferFrom(user1.address, user2.address, approveAmount);
      
      expect(await roseToken.balanceOf(user1.address)).to.equal(ethers.parseEther("50"));
      expect(await roseToken.balanceOf(user2.address)).to.equal(approveAmount);
      expect(await roseToken.allowance(user1.address, user2.address)).to.equal(0);
    });

    it("Should revert transferFrom with insufficient allowance", async function () {
      const approveAmount = ethers.parseEther("50");
      const transferAmount = ethers.parseEther("60");
      
      await roseToken.connect(user1).approve(user2.address, approveAmount);
      
      await expect(
        roseToken.connect(user2).transferFrom(user1.address, user2.address, transferAmount)
      ).to.be.revertedWith("Insufficient allowance");
    });
  });
});
