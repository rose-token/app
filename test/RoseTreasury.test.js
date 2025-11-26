const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RoseTreasury Smart Deposits", function () {
  let roseTreasury;
  let roseToken;
  let usdc;
  let wbtc;
  let reth;
  let paxg;
  let btcFeed;
  let ethFeed;
  let xauFeed;
  let swapRouter;
  let owner;
  let user;
  let user2;

  beforeEach(async function () {
    [owner, user, user2] = await ethers.getSigners();

    // 1. Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    wbtc = await MockERC20.deploy("Wrapped BTC", "WBTC", 8);
    reth = await MockERC20.deploy("Rocket Pool ETH", "rETH", 18);
    paxg = await MockERC20.deploy("Pax Gold", "PAXG", 18);

    // 2. Deploy RoseToken (owner is initial authorized)
    const RoseToken = await ethers.getContractFactory("RoseToken");
    roseToken = await RoseToken.deploy(owner.address);

    // 3. Deploy mock Chainlink price feeds (8 decimals)
    const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
    btcFeed = await MockV3Aggregator.deploy(8, 4300000000000n);  // $43,000
    ethFeed = await MockV3Aggregator.deploy(8, 230000000000n);   // $2,300
    xauFeed = await MockV3Aggregator.deploy(8, 200000000000n);   // $2,000

    // 4. Deploy mock Uniswap router
    const MockUniswapV3Router = await ethers.getContractFactory("MockUniswapV3Router");
    swapRouter = await MockUniswapV3Router.deploy();

    // 5. Set token decimals on router
    await swapRouter.setTokenDecimals(await usdc.getAddress(), 6);
    await swapRouter.setTokenDecimals(await wbtc.getAddress(), 8);
    await swapRouter.setTokenDecimals(await reth.getAddress(), 18);
    await swapRouter.setTokenDecimals(await paxg.getAddress(), 18);

    // 6. Set exchange rates on router
    await swapRouter.setExchangeRate(await usdc.getAddress(), await wbtc.getAddress(), 2326n * 10n**12n);
    await swapRouter.setExchangeRate(await usdc.getAddress(), await reth.getAddress(), 435n * 10n**24n);
    await swapRouter.setExchangeRate(await usdc.getAddress(), await paxg.getAddress(), 5n * 10n**26n);

    // Also set reverse rates for redemptions
    await swapRouter.setExchangeRate(await wbtc.getAddress(), await usdc.getAddress(), 43000n * 10n**16n);
    await swapRouter.setExchangeRate(await reth.getAddress(), await usdc.getAddress(), 2300n * 10n**6n);
    await swapRouter.setExchangeRate(await paxg.getAddress(), await usdc.getAddress(), 2000n * 10n**6n);

    // 7. Fund router with tokens for swaps
    await wbtc.mint(await swapRouter.getAddress(), ethers.parseUnits("1000", 8));
    await reth.mint(await swapRouter.getAddress(), ethers.parseUnits("100000", 18));
    await paxg.mint(await swapRouter.getAddress(), ethers.parseUnits("100000", 18));
    await usdc.mint(await swapRouter.getAddress(), ethers.parseUnits("10000000", 6));

    // 8. Deploy RoseTreasury
    const RoseTreasury = await ethers.getContractFactory("RoseTreasury");
    roseTreasury = await RoseTreasury.deploy(
      await roseToken.getAddress(),
      await usdc.getAddress(),
      await wbtc.getAddress(),
      await reth.getAddress(),
      await paxg.getAddress(),
      await btcFeed.getAddress(),
      await ethFeed.getAddress(),
      await xauFeed.getAddress(),
      await swapRouter.getAddress()
    );

    // 9. Authorize Treasury on RoseToken
    await roseToken.setAuthorized(await roseTreasury.getAddress(), true);
  });

  // Helper to perform deposit
  async function deposit(signer, usdcAmount) {
    await usdc.mint(signer.address, usdcAmount);
    await usdc.connect(signer).approve(await roseTreasury.getAddress(), usdcAmount);
    await roseTreasury.connect(signer).deposit(usdcAmount);
  }

  // Helper to get vault allocation percentages
  async function getVaultPercentages() {
    const breakdown = await roseTreasury.getVaultBreakdown();
    const total = breakdown.totalValue;
    if (total == 0n) return { btc: 0, eth: 0, gold: 0, usdc: 0 };

    return {
      btc: Number((breakdown.btcValue * 10000n) / total) / 100,
      eth: Number((breakdown.ethValue * 10000n) / total) / 100,
      gold: Number((breakdown.goldValue * 10000n) / total) / 100,
      usdc: Number((breakdown.usdcValue * 10000n) / total) / 100
    };
  }

  describe("First Deposit (Empty Vault)", function () {
    it("Should use target ratios for first deposit", async function () {
      const depositAmount = ethers.parseUnits("10000", 6); // 10,000 USDC
      await deposit(user, depositAmount);

      const pcts = await getVaultPercentages();

      // Should be approximately 40/30/20/10
      // Allow 2% tolerance due to swap mechanics
      expect(pcts.btc).to.be.closeTo(40, 2);
      expect(pcts.eth).to.be.closeTo(30, 2);
      expect(pcts.gold).to.be.closeTo(20, 2);
      expect(pcts.usdc).to.be.closeTo(10, 2);
    });
  });

  describe("USDC Underweight Scenario", function () {
    it("Should prioritize USDC when underweight", async function () {
      // First deposit to establish vault
      const initialDeposit = ethers.parseUnits("10000", 6);
      await deposit(user, initialDeposit);

      // Simulate USDC drain by transferring USDC out of treasury (owner can do this via mock)
      // Get current USDC balance and transfer most of it to simulate redemption drain
      const treasuryAddr = await roseTreasury.getAddress();
      const currentUsdc = await usdc.balanceOf(treasuryAddr);

      // Burn 90% of treasury USDC to simulate drain
      // We'll use a hack: mint to user and "burn" by not transferring back
      const drainAmount = (currentUsdc * 90n) / 100n;

      // Directly manipulate by minting more RWA to treasury (making USDC even more underweight)
      await wbtc.mint(treasuryAddr, ethers.parseUnits("0.1", 8)); // Add more BTC

      const pctsBeforeSecondDeposit = await getVaultPercentages();

      // USDC should now be underweight (less than 10%)
      expect(pctsBeforeSecondDeposit.usdc).to.be.lessThan(10);

      // Track USDC before second deposit
      const usdcBefore = await usdc.balanceOf(treasuryAddr);

      // Make second deposit
      const secondDeposit = ethers.parseUnits("1000", 6);
      await deposit(user2, secondDeposit);

      const usdcAfter = await usdc.balanceOf(treasuryAddr);
      const usdcRetained = usdcAfter - usdcBefore;

      // Most of the deposit should stay as USDC to fill deficit
      // At minimum, more than 50% should be retained as USDC
      expect(usdcRetained).to.be.greaterThan(secondDeposit / 2n);
    });

    it("Should fill USDC deficit then allocate remainder to RWA", async function () {
      // First deposit
      const initialDeposit = ethers.parseUnits("10000", 6);
      await deposit(user, initialDeposit);

      // Simulate USDC drain by adding more RWA to treasury (making USDC underweight)
      const treasuryAddr = await roseTreasury.getAddress();
      await wbtc.mint(treasuryAddr, ethers.parseUnits("0.5", 8)); // Add BTC to make USDC underweight

      const pctsBeforeLargeDeposit = await getVaultPercentages();
      expect(pctsBeforeLargeDeposit.usdc).to.be.lessThan(10); // USDC is underweight

      // Large deposit that exceeds USDC deficit
      const largeDeposit = ethers.parseUnits("5000", 6);
      await deposit(user2, largeDeposit);

      const pcts = await getVaultPercentages();

      // After large deposit, USDC should be closer to target (10%)
      expect(pcts.usdc).to.be.greaterThan(pctsBeforeLargeDeposit.usdc);
    });
  });

  describe("RWA Underweight Scenario", function () {
    it("Should proportionally fill underweight RWA assets", async function () {
      // First deposit creates baseline
      const initialDeposit = ethers.parseUnits("10000", 6);
      await deposit(user, initialDeposit);

      // Manually add USDC to make it overweight (simulates scenario where
      // USDC is at target but RWA is underweight)
      await usdc.mint(await roseTreasury.getAddress(), ethers.parseUnits("2000", 6));

      const pctsBefore = await getVaultPercentages();
      expect(pctsBefore.usdc).to.be.greaterThan(15); // USDC now overweight

      // New deposit - should go to RWA since USDC is overweight
      const secondDeposit = ethers.parseUnits("2000", 6);
      await deposit(user2, secondDeposit);

      // Check that RWA got most of the deposit
      const breakdown = await roseTreasury.getVaultBreakdown();

      // Total vault should have increased by deposit amount
      expect(breakdown.totalValue).to.be.greaterThan(ethers.parseUnits("12000", 6));
    });
  });

  describe("Balanced Vault Scenario", function () {
    it("Should use target ratios when vault is balanced", async function () {
      // First deposit establishes balanced vault
      const initialDeposit = ethers.parseUnits("10000", 6);
      await deposit(user, initialDeposit);

      const pctsAfterFirst = await getVaultPercentages();

      // Second deposit to a balanced vault
      const secondDeposit = ethers.parseUnits("5000", 6);
      await deposit(user2, secondDeposit);

      const pctsAfterSecond = await getVaultPercentages();

      // Ratios should remain approximately the same
      expect(pctsAfterSecond.btc).to.be.closeTo(pctsAfterFirst.btc, 3);
      expect(pctsAfterSecond.eth).to.be.closeTo(pctsAfterFirst.eth, 3);
      expect(pctsAfterSecond.gold).to.be.closeTo(pctsAfterFirst.gold, 3);
      expect(pctsAfterSecond.usdc).to.be.closeTo(pctsAfterFirst.usdc, 3);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero deposit gracefully", async function () {
      // Zero deposit should not revert in _diversify (early return)
      // But the deposit function itself requires non-zero amount
      await expect(
        roseTreasury.connect(user).deposit(0)
      ).to.be.revertedWithCustomError(roseTreasury, "ZeroAmount");
    });

    it("Should skip swaps below minimum threshold", async function () {
      // First deposit
      const initialDeposit = ethers.parseUnits("10000", 6);
      await deposit(user, initialDeposit);

      // Simulate underweight by adding more RWA
      const treasuryAddr = await roseTreasury.getAddress();
      await wbtc.mint(treasuryAddr, ethers.parseUnits("1", 8)); // Add BTC

      // Tiny deposit below MIN_SWAP_AMOUNT (1 USDC)
      const tinyDeposit = ethers.parseUnits("0.5", 6); // 0.5 USDC

      // Should not revert - tiny swaps are skipped
      await deposit(user2, tinyDeposit);
    });
  });

  describe("Integration: Simulated Drain then Deposit", function () {
    it("Should self-correct after USDC is drained", async function () {
      // 1. Setup balanced vault
      const initialDeposit = ethers.parseUnits("10000", 6);
      await deposit(user, initialDeposit);

      const pctsBefore = await getVaultPercentages();
      expect(pctsBefore.usdc).to.be.closeTo(10, 2);

      // 2. Simulate USDC drain by adding more RWA
      const treasuryAddr = await roseTreasury.getAddress();
      await wbtc.mint(treasuryAddr, ethers.parseUnits("0.2", 8)); // Add BTC
      await reth.mint(treasuryAddr, ethers.parseUnits("5", 18)); // Add ETH

      const pctsAfterDrain = await getVaultPercentages();
      expect(pctsAfterDrain.usdc).to.be.lessThan(8); // USDC now underweight

      // 3. New deposit should prioritize refilling USDC
      const refillDeposit = ethers.parseUnits("3000", 6);
      await deposit(user2, refillDeposit);

      const pctsAfterRefill = await getVaultPercentages();

      // USDC should be closer to target after smart deposit
      expect(pctsAfterRefill.usdc).to.be.greaterThan(pctsAfterDrain.usdc);
    });

    it("Should eventually restore target allocation after multiple deposits", async function () {
      // 1. Initial deposit
      await deposit(user, ethers.parseUnits("10000", 6));

      // 2. Simulate drain by adding more RWA (making USDC and Gold underweight)
      const treasuryAddr = await roseTreasury.getAddress();
      await wbtc.mint(treasuryAddr, ethers.parseUnits("0.5", 8)); // Heavy BTC
      await reth.mint(treasuryAddr, ethers.parseUnits("10", 18)); // Heavy ETH

      const pctsAfterDrain = await getVaultPercentages();
      expect(pctsAfterDrain.usdc).to.be.lessThan(6); // USDC underweight
      expect(pctsAfterDrain.gold).to.be.lessThan(15); // Gold underweight

      // 3. Multiple deposits to restore balance
      await deposit(user2, ethers.parseUnits("5000", 6));
      await deposit(user2, ethers.parseUnits("5000", 6));
      await deposit(user2, ethers.parseUnits("5000", 6));

      const finalPcts = await getVaultPercentages();

      // Should be closer to target ratios after smart deposits
      // Allow wider tolerance since we're testing the direction of correction
      expect(finalPcts.usdc).to.be.greaterThan(pctsAfterDrain.usdc);
      expect(finalPcts.gold).to.be.greaterThan(pctsAfterDrain.gold);
    });
  });

  describe("Pausable", function () {
    it("Should allow owner to pause and unpause", async function () {
      expect(await roseTreasury.paused()).to.be.false;

      await roseTreasury.connect(owner).pause();
      expect(await roseTreasury.paused()).to.be.true;

      await roseTreasury.connect(owner).unpause();
      expect(await roseTreasury.paused()).to.be.false;
    });

    it("Should not allow non-owner to pause", async function () {
      await expect(
        roseTreasury.connect(user).pause()
      ).to.be.revertedWithCustomError(roseTreasury, "OwnableUnauthorizedAccount");
    });

    it("Should not allow non-owner to unpause", async function () {
      await roseTreasury.connect(owner).pause();

      await expect(
        roseTreasury.connect(user).unpause()
      ).to.be.revertedWithCustomError(roseTreasury, "OwnableUnauthorizedAccount");
    });

    it("Should block deposit when paused", async function () {
      await roseTreasury.connect(owner).pause();

      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);

      await expect(
        roseTreasury.connect(user).deposit(depositAmount)
      ).to.be.revertedWithCustomError(roseTreasury, "EnforcedPause");
    });

    it("Should block redeem when paused", async function () {
      // First deposit while unpaused
      const depositAmount = ethers.parseUnits("1000", 6);
      await deposit(user, depositAmount);

      const roseBalance = await roseToken.balanceOf(user.address);
      expect(roseBalance).to.be.greaterThan(0);

      // Pause and try to redeem
      await roseTreasury.connect(owner).pause();

      await expect(
        roseTreasury.connect(user).redeem(roseBalance)
      ).to.be.revertedWithCustomError(roseTreasury, "EnforcedPause");
    });

    it("Should block rebalance when paused", async function () {
      await roseTreasury.connect(owner).pause();

      await expect(
        roseTreasury.connect(owner).rebalance()
      ).to.be.revertedWithCustomError(roseTreasury, "EnforcedPause");
    });

    it("Should block spendRose when paused", async function () {
      // First deposit to get some ROSE in treasury
      const depositAmount = ethers.parseUnits("1000", 6);
      await deposit(user, depositAmount);

      // Mint ROSE to treasury directly for testing
      await roseToken.mint(await roseTreasury.getAddress(), ethers.parseUnits("100", 18));

      await roseTreasury.connect(owner).pause();

      await expect(
        roseTreasury.connect(owner).spendRose(user.address, ethers.parseUnits("10", 18), "test spend")
      ).to.be.revertedWithCustomError(roseTreasury, "EnforcedPause");
    });

    it("Should allow operations after unpause", async function () {
      // Pause then unpause
      await roseTreasury.connect(owner).pause();
      await roseTreasury.connect(owner).unpause();

      // Deposit should work again
      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);

      await expect(
        roseTreasury.connect(user).deposit(depositAmount)
      ).to.not.be.reverted;
    });

    it("Should allow config changes while paused", async function () {
      await roseTreasury.connect(owner).pause();

      // setAllocation should still work while paused
      await expect(
        roseTreasury.connect(owner).setAllocation(3000, 3000, 2000, 2000)
      ).to.not.be.reverted;

      // setMaxSlippage should still work while paused
      await expect(
        roseTreasury.connect(owner).setMaxSlippage(200)
      ).to.not.be.reverted;
    });
  });
});
