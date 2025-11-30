const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("vROSE", function () {
  let vRose;
  let owner;
  let governance;
  let marketplace;
  let user1;
  let user2;

  beforeEach(async function () {
    [owner, governance, marketplace, user1, user2] = await ethers.getSigners();

    const VROSE = await ethers.getContractFactory("vROSE");
    vRose = await VROSE.deploy();
    await vRose.waitForDeployment();

    // Set governance and marketplace addresses
    await vRose.setGovernance(governance.address);
    await vRose.setMarketplace(marketplace.address);
  });

  describe("Deployment", function () {
    it("Should set the correct token name and symbol", async function () {
      expect(await vRose.name()).to.equal("Voting Rose Token");
      expect(await vRose.symbol()).to.equal("vROSE");
      expect(await vRose.decimals()).to.equal(18);
    });

    it("Should set deployer as owner", async function () {
      expect(await vRose.owner()).to.equal(owner.address);
    });

    it("Should start with zero total supply", async function () {
      expect(await vRose.totalSupply()).to.equal(0);
    });

    it("Should set governance address correctly", async function () {
      expect(await vRose.governance()).to.equal(governance.address);
    });

    it("Should set marketplace address correctly", async function () {
      expect(await vRose.marketplace()).to.equal(marketplace.address);
    });
  });

  describe("Marketplace-Only Transfers", function () {
    beforeEach(async function () {
      // Mint some vROSE to user1 for testing
      const mintAmount = ethers.parseEther("100");
      await vRose.connect(governance).mint(user1.address, mintAmount);
    });

    it("Should allow user to approve marketplace", async function () {
      const approveAmount = ethers.parseEther("50");

      await expect(vRose.connect(user1).approve(marketplace.address, approveAmount))
        .to.emit(vRose, "Approval")
        .withArgs(user1.address, marketplace.address, approveAmount);

      expect(await vRose.allowance(user1.address, marketplace.address)).to.equal(approveAmount);
    });

    it("Should revert approval to non-marketplace", async function () {
      const approveAmount = ethers.parseEther("50");

      await expect(
        vRose.connect(user1).approve(user2.address, approveAmount)
      ).to.be.revertedWithCustomError(vRose, "OnlyMarketplaceApproval");
    });

    it("Should allow user to transfer to marketplace", async function () {
      const transferAmount = ethers.parseEther("50");

      await expect(vRose.connect(user1).transfer(marketplace.address, transferAmount))
        .to.emit(vRose, "Transfer")
        .withArgs(user1.address, marketplace.address, transferAmount);

      expect(await vRose.balanceOf(user1.address)).to.equal(ethers.parseEther("50"));
      expect(await vRose.balanceOf(marketplace.address)).to.equal(transferAmount);
    });

    it("Should revert transfer to non-marketplace", async function () {
      const transferAmount = ethers.parseEther("50");

      await expect(
        vRose.connect(user1).transfer(user2.address, transferAmount)
      ).to.be.revertedWithCustomError(vRose, "OnlyMarketplaceTransfer");
    });

    it("Should allow marketplace to transferFrom user to marketplace", async function () {
      const transferAmount = ethers.parseEther("50");

      // User approves marketplace
      await vRose.connect(user1).approve(marketplace.address, transferAmount);

      // Marketplace calls transferFrom
      await expect(
        vRose.connect(marketplace).transferFrom(user1.address, marketplace.address, transferAmount)
      )
        .to.emit(vRose, "Transfer")
        .withArgs(user1.address, marketplace.address, transferAmount);

      expect(await vRose.balanceOf(user1.address)).to.equal(ethers.parseEther("50"));
      expect(await vRose.balanceOf(marketplace.address)).to.equal(transferAmount);
    });

    it("Should allow marketplace to transfer back to user", async function () {
      const transferAmount = ethers.parseEther("50");

      // First transfer to marketplace
      await vRose.connect(user1).transfer(marketplace.address, transferAmount);

      // Marketplace transfers back to user
      await expect(
        vRose.connect(marketplace).transfer(user1.address, transferAmount)
      )
        .to.emit(vRose, "Transfer")
        .withArgs(marketplace.address, user1.address, transferAmount);

      expect(await vRose.balanceOf(user1.address)).to.equal(ethers.parseEther("100"));
      expect(await vRose.balanceOf(marketplace.address)).to.equal(0);
    });

    it("Should allow marketplace to transferFrom marketplace to user (without approval)", async function () {
      const transferAmount = ethers.parseEther("50");

      // First transfer to marketplace
      await vRose.connect(user1).transfer(marketplace.address, transferAmount);

      // Marketplace transfers back to user (from itself)
      await expect(
        vRose.connect(marketplace).transferFrom(marketplace.address, user1.address, transferAmount)
      )
        .to.emit(vRose, "Transfer")
        .withArgs(marketplace.address, user1.address, transferAmount);

      expect(await vRose.balanceOf(user1.address)).to.equal(ethers.parseEther("100"));
    });

    it("Should revert transferFrom if neither party is marketplace", async function () {
      const transferAmount = ethers.parseEther("50");

      await expect(
        vRose.connect(user2).transferFrom(user1.address, user2.address, transferAmount)
      ).to.be.revertedWithCustomError(vRose, "OnlyMarketplaceTransfer");
    });

    it("Should revert transferFrom if user hasn't approved enough", async function () {
      const transferAmount = ethers.parseEther("50");

      // User approves less than transfer amount
      await vRose.connect(user1).approve(marketplace.address, ethers.parseEther("20"));

      await expect(
        vRose.connect(marketplace).transferFrom(user1.address, marketplace.address, transferAmount)
      ).to.be.revertedWithCustomError(vRose, "InsufficientBalance");
    });

    it("Should deduct from allowance on transferFrom", async function () {
      const approveAmount = ethers.parseEther("100");
      const transferAmount = ethers.parseEther("30");

      await vRose.connect(user1).approve(marketplace.address, approveAmount);
      await vRose.connect(marketplace).transferFrom(user1.address, marketplace.address, transferAmount);

      expect(await vRose.allowance(user1.address, marketplace.address)).to.equal(
        ethers.parseEther("70")
      );
    });

    it("Should revert transfer if insufficient balance", async function () {
      const transferAmount = ethers.parseEther("150"); // More than user has

      await expect(
        vRose.connect(user1).transfer(marketplace.address, transferAmount)
      ).to.be.revertedWithCustomError(vRose, "InsufficientBalance");
    });
  });

  describe("Minting", function () {
    it("Should allow governance to mint tokens", async function () {
      const mintAmount = ethers.parseEther("100");

      await vRose.connect(governance).mint(user1.address, mintAmount);

      expect(await vRose.totalSupply()).to.equal(mintAmount);
      expect(await vRose.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should emit Transfer event on mint", async function () {
      const mintAmount = ethers.parseEther("100");

      await expect(vRose.connect(governance).mint(user1.address, mintAmount))
        .to.emit(vRose, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, mintAmount);
    });

    it("Should revert if non-governance tries to mint", async function () {
      const mintAmount = ethers.parseEther("100");

      await expect(
        vRose.connect(user1).mint(user2.address, mintAmount)
      ).to.be.revertedWithCustomError(vRose, "NotGovernance");
    });

    it("Should revert if minting to zero address", async function () {
      const mintAmount = ethers.parseEther("100");

      await expect(
        vRose.connect(governance).mint(ethers.ZeroAddress, mintAmount)
      ).to.be.revertedWithCustomError(vRose, "ZeroAddress");
    });

    it("Should revert if minting zero amount", async function () {
      await expect(
        vRose.connect(governance).mint(user1.address, 0)
      ).to.be.revertedWithCustomError(vRose, "ZeroAmount");
    });
  });

  describe("Burning", function () {
    beforeEach(async function () {
      const mintAmount = ethers.parseEther("100");
      await vRose.connect(governance).mint(user1.address, mintAmount);
    });

    it("Should allow governance to burn tokens", async function () {
      const burnAmount = ethers.parseEther("50");

      await vRose.connect(governance).burn(user1.address, burnAmount);

      expect(await vRose.totalSupply()).to.equal(ethers.parseEther("50"));
      expect(await vRose.balanceOf(user1.address)).to.equal(ethers.parseEther("50"));
    });

    it("Should emit Transfer event on burn", async function () {
      const burnAmount = ethers.parseEther("50");

      await expect(vRose.connect(governance).burn(user1.address, burnAmount))
        .to.emit(vRose, "Transfer")
        .withArgs(user1.address, ethers.ZeroAddress, burnAmount);
    });

    it("Should revert if non-governance tries to burn", async function () {
      const burnAmount = ethers.parseEther("50");

      await expect(
        vRose.connect(user1).burn(user1.address, burnAmount)
      ).to.be.revertedWithCustomError(vRose, "NotGovernance");
    });

    it("Should revert if burning from zero address", async function () {
      const burnAmount = ethers.parseEther("50");

      await expect(
        vRose.connect(governance).burn(ethers.ZeroAddress, burnAmount)
      ).to.be.revertedWithCustomError(vRose, "ZeroAddress");
    });

    it("Should revert if burning zero amount", async function () {
      await expect(
        vRose.connect(governance).burn(user1.address, 0)
      ).to.be.revertedWithCustomError(vRose, "ZeroAmount");
    });

    it("Should revert if burning more than balance", async function () {
      const burnAmount = ethers.parseEther("150");

      await expect(
        vRose.connect(governance).burn(user1.address, burnAmount)
      ).to.be.revertedWithCustomError(vRose, "InsufficientBalance");
    });

    it("Should burn correctly when user has full balance", async function () {
      const burnAmount = ethers.parseEther("100");

      await vRose.connect(governance).burn(user1.address, burnAmount);

      expect(await vRose.balanceOf(user1.address)).to.equal(0);
      expect(await vRose.totalSupply()).to.equal(0);
    });

    it("Should allow burn when vROSE is not in marketplace escrow", async function () {
      // User has 100 vROSE, none in marketplace
      const burnAmount = ethers.parseEther("100");

      await vRose.connect(governance).burn(user1.address, burnAmount);
      expect(await vRose.balanceOf(user1.address)).to.equal(0);
    });

    it("Should fail burn when vROSE is in marketplace escrow (balance is lower)", async function () {
      // Transfer 80 vROSE to marketplace (real escrow)
      await vRose.connect(user1).transfer(marketplace.address, ethers.parseEther("80"));

      // User now has 20 vROSE balance, try to burn 30
      await expect(
        vRose.connect(governance).burn(user1.address, ethers.parseEther("30"))
      ).to.be.revertedWithCustomError(vRose, "InsufficientBalance");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set governance", async function () {
      await vRose.setGovernance(user2.address);
      expect(await vRose.governance()).to.equal(user2.address);
    });

    it("Should emit GovernanceUpdated event", async function () {
      await expect(vRose.setGovernance(user2.address))
        .to.emit(vRose, "GovernanceUpdated")
        .withArgs(user2.address);
    });

    it("Should revert if non-owner sets governance", async function () {
      await expect(
        vRose.connect(user1).setGovernance(user2.address)
      ).to.be.revertedWithCustomError(vRose, "NotOwner");
    });

    it("Should revert if setting governance to zero address", async function () {
      await expect(
        vRose.setGovernance(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vRose, "ZeroAddress");
    });

    it("Should allow owner to set marketplace", async function () {
      await vRose.setMarketplace(user2.address);
      expect(await vRose.marketplace()).to.equal(user2.address);
    });

    it("Should emit MarketplaceUpdated event", async function () {
      await expect(vRose.setMarketplace(user2.address))
        .to.emit(vRose, "MarketplaceUpdated")
        .withArgs(user2.address);
    });

    it("Should revert if non-owner sets marketplace", async function () {
      await expect(
        vRose.connect(user1).setMarketplace(user2.address)
      ).to.be.revertedWithCustomError(vRose, "NotOwner");
    });

    it("Should revert if setting marketplace to zero address", async function () {
      await expect(
        vRose.setMarketplace(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vRose, "ZeroAddress");
    });

    it("Should allow owner to transfer ownership", async function () {
      await vRose.transferOwnership(user1.address);
      expect(await vRose.owner()).to.equal(user1.address);
    });

    it("Should revert if non-owner transfers ownership", async function () {
      await expect(
        vRose.connect(user1).transferOwnership(user2.address)
      ).to.be.revertedWithCustomError(vRose, "NotOwner");
    });

    it("Should revert if transferring ownership to zero address", async function () {
      await expect(
        vRose.transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vRose, "ZeroAddress");
    });
  });

  describe("Escrow Flow Integration", function () {
    beforeEach(async function () {
      const mintAmount = ethers.parseEther("100");
      await vRose.connect(governance).mint(user1.address, mintAmount);
    });

    it("Should support full escrow lifecycle", async function () {
      const escrowAmount = ethers.parseEther("50");

      // 1. User approves marketplace
      await vRose.connect(user1).approve(marketplace.address, escrowAmount);
      expect(await vRose.allowance(user1.address, marketplace.address)).to.equal(escrowAmount);

      // 2. Marketplace transfers vROSE to itself (stakeholder stake)
      await vRose.connect(marketplace).transferFrom(user1.address, marketplace.address, escrowAmount);
      expect(await vRose.balanceOf(user1.address)).to.equal(ethers.parseEther("50"));
      expect(await vRose.balanceOf(marketplace.address)).to.equal(escrowAmount);

      // 3. vROSE is in real escrow - user cannot transfer it
      expect(await vRose.balanceOf(user1.address)).to.equal(ethers.parseEther("50")); // Only 50 left

      // 4. Task completes - marketplace returns vROSE
      await vRose.connect(marketplace).transfer(user1.address, escrowAmount);
      expect(await vRose.balanceOf(user1.address)).to.equal(ethers.parseEther("100"));
      expect(await vRose.balanceOf(marketplace.address)).to.equal(0);
    });

    it("Should prevent governance burn when vROSE is in escrow", async function () {
      const escrowAmount = ethers.parseEther("80");

      // Transfer to marketplace
      await vRose.connect(user1).transfer(marketplace.address, escrowAmount);

      // User now only has 20 vROSE
      expect(await vRose.balanceOf(user1.address)).to.equal(ethers.parseEther("20"));

      // Cannot burn more than balance
      await expect(
        vRose.connect(governance).burn(user1.address, ethers.parseEther("30"))
      ).to.be.revertedWithCustomError(vRose, "InsufficientBalance");

      // Can burn up to balance
      await vRose.connect(governance).burn(user1.address, ethers.parseEther("20"));
      expect(await vRose.balanceOf(user1.address)).to.equal(0);
    });
  });
});
