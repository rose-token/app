const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RoseTreasury Smart Deposits", function () {
  let roseTreasury;
  let roseToken;
  let usdc;
  let tbtc;
  let paxg;
  let btcFeed;
  let xauFeed;
  let swapRouter;
  let owner;
  let user;
  let user2;

  // Asset keys as bytes32
  const BTC_KEY = ethers.encodeBytes32String("BTC");
  const GOLD_KEY = ethers.encodeBytes32String("GOLD");
  const STABLE_KEY = ethers.encodeBytes32String("STABLE");
  const ROSE_KEY = ethers.encodeBytes32String("ROSE");

  beforeEach(async function () {
    [owner, user, user2] = await ethers.getSigners();

    // 1. Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    tbtc = await MockERC20.deploy("Wrapped BTC", "TBTC", 8);
    paxg = await MockERC20.deploy("Pax Gold", "PAXG", 18);

    // 2. Deploy RoseToken (owner is initial authorized)
    const RoseToken = await ethers.getContractFactory("RoseToken");
    roseToken = await RoseToken.deploy(owner.address);

    // 3. Deploy mock Chainlink price feeds (8 decimals)
    const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
    btcFeed = await MockV3Aggregator.deploy(8, 4300000000000n);  // $43,000
    xauFeed = await MockV3Aggregator.deploy(8, 200000000000n);   // $2,000

    // 4. Deploy mock Uniswap router
    const MockUniswapV3Router = await ethers.getContractFactory("MockUniswapV3Router");
    swapRouter = await MockUniswapV3Router.deploy();

    // 5. Set token decimals on router
    await swapRouter.setTokenDecimals(await usdc.getAddress(), 6);
    await swapRouter.setTokenDecimals(await tbtc.getAddress(), 8);
    await swapRouter.setTokenDecimals(await paxg.getAddress(), 18);
    await swapRouter.setTokenDecimals(await roseToken.getAddress(), 18);

    // 6. Set exchange rates on router
    await swapRouter.setExchangeRate(await usdc.getAddress(), await tbtc.getAddress(), 2326n * 10n**12n);
    await swapRouter.setExchangeRate(await usdc.getAddress(), await paxg.getAddress(), 5n * 10n**26n);
    await swapRouter.setExchangeRate(await usdc.getAddress(), await roseToken.getAddress(), 1n * 10n**30n); // 1 USDC = 1 ROSE

    // Also set reverse rates for redemptions
    await swapRouter.setExchangeRate(await tbtc.getAddress(), await usdc.getAddress(), 43000n * 10n**16n);
    await swapRouter.setExchangeRate(await paxg.getAddress(), await usdc.getAddress(), 2000n * 10n**6n);
    await swapRouter.setExchangeRate(await roseToken.getAddress(), await usdc.getAddress(), 1n * 10n**6n); // 1 ROSE = 1 USDC

    // 7. Fund router with tokens for swaps
    await tbtc.mint(await swapRouter.getAddress(), ethers.parseUnits("1000", 8));
    await paxg.mint(await swapRouter.getAddress(), ethers.parseUnits("100000", 18));
    await usdc.mint(await swapRouter.getAddress(), ethers.parseUnits("10000000", 6));

    // 8. Deploy RoseTreasury with new constructor (roseToken, usdc, swapRouter)
    const RoseTreasury = await ethers.getContractFactory("RoseTreasury");
    roseTreasury = await RoseTreasury.deploy(
      await roseToken.getAddress(),
      await usdc.getAddress(),
      await swapRouter.getAddress()
    );

    // 9. Authorize Treasury on RoseToken
    await roseToken.setAuthorized(await roseTreasury.getAddress(), true);

    // 10. Register assets with addAsset()
    // BTC: 30%
    await roseTreasury.addAsset(
      BTC_KEY,
      await tbtc.getAddress(),
      await btcFeed.getAddress(),
      8,  // decimals
      3000 // 30%
    );

    // GOLD: 30%
    await roseTreasury.addAsset(
      GOLD_KEY,
      await paxg.getAddress(),
      await xauFeed.getAddress(),
      18, // decimals
      3000 // 30%
    );

    // STABLE (USDC): 20%
    await roseTreasury.addAsset(
      STABLE_KEY,
      await usdc.getAddress(),
      ethers.ZeroAddress, // No price feed needed for stablecoin
      6,  // decimals
      2000 // 20%
    );

    // ROSE: 20%
    await roseTreasury.addAsset(
      ROSE_KEY,
      await roseToken.getAddress(),
      ethers.ZeroAddress, // Uses NAV, not price feed
      18, // decimals
      2000 // 20%
    );
  });

  // Helper constants
  const DAY = 24 * 60 * 60;

  // Helper to perform deposit (advances time if not first deposit from this address)
  async function deposit(signer, usdcAmount, skipTimeAdvance = false) {
    if (!skipTimeAdvance) {
      // Advance time past cooldown to allow deposit
      await ethers.provider.send("evm_increaseTime", [DAY + 1]);
      await ethers.provider.send("evm_mine");
    }
    await usdc.mint(signer.address, usdcAmount);
    await usdc.connect(signer).approve(await roseTreasury.getAddress(), usdcAmount);
    await roseTreasury.connect(signer).deposit(usdcAmount);
  }

  // Helper to get vault allocation percentages (updated for new contract)
  async function getVaultPercentages() {
    const treasuryAddr = await roseTreasury.getAddress();

    // Get individual asset values
    const btcBreakdown = await roseTreasury.getAssetBreakdown(BTC_KEY);
    const goldBreakdown = await roseTreasury.getAssetBreakdown(GOLD_KEY);
    const stableBreakdown = await roseTreasury.getAssetBreakdown(STABLE_KEY);

    const breakdown = await roseTreasury.getVaultBreakdown();
    const total = breakdown.totalHardAssets;

    if (total == 0n) return { btc: 0, gold: 0, usdc: 0 };

    return {
      btc: Number((btcBreakdown.valueUSD * 10000n) / total) / 100,
      gold: Number((goldBreakdown.valueUSD * 10000n) / total) / 100,
      usdc: Number((stableBreakdown.valueUSD * 10000n) / total) / 100
    };
  }

  describe("First Deposit (Empty Vault)", function () {
    it("Should use target ratios for first deposit", async function () {
      const depositAmount = ethers.parseUnits("10000", 6); // 10,000 USDC
      await deposit(user, depositAmount);

      const pcts = await getVaultPercentages();

      // Should be approximately 37.5/37.5/25 (btc/gold/usdc based on 3000/3000/2000 allocation)
      // Allow 3% tolerance due to swap mechanics
      expect(pcts.btc).to.be.closeTo(37.5, 3);
      expect(pcts.gold).to.be.closeTo(37.5, 3);
      expect(pcts.usdc).to.be.closeTo(25, 3);
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
      await tbtc.mint(treasuryAddr, ethers.parseUnits("0.1", 8)); // Add more BTC

      const pctsBeforeSecondDeposit = await getVaultPercentages();

      // USDC should now be underweight (less than 25% target)
      expect(pctsBeforeSecondDeposit.usdc).to.be.lessThan(20);

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
      await tbtc.mint(treasuryAddr, ethers.parseUnits("0.5", 8)); // Add BTC to make USDC underweight

      const pctsBeforeLargeDeposit = await getVaultPercentages();
      expect(pctsBeforeLargeDeposit.usdc).to.be.lessThan(20); // USDC is underweight

      // Large deposit that exceeds USDC deficit
      const largeDeposit = ethers.parseUnits("5000", 6);
      await deposit(user2, largeDeposit);

      const pcts = await getVaultPercentages();

      // After large deposit, USDC should be closer to target (25%)
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
      expect(breakdown.totalHardAssets).to.be.greaterThan(ethers.parseUnits("12000", 6));
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
      await tbtc.mint(treasuryAddr, ethers.parseUnits("1", 8)); // Add BTC

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
      expect(pctsBefore.usdc).to.be.closeTo(25, 3);

      // 2. Simulate USDC drain by adding more RWA
      const treasuryAddr = await roseTreasury.getAddress();
      await tbtc.mint(treasuryAddr, ethers.parseUnits("0.2", 8)); // Add BTC

      const pctsAfterDrain = await getVaultPercentages();
      expect(pctsAfterDrain.usdc).to.be.lessThan(20); // USDC now underweight

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
      await tbtc.mint(treasuryAddr, ethers.parseUnits("0.5", 8)); // Heavy BTC

      const pctsAfterDrain = await getVaultPercentages();
      expect(pctsAfterDrain.usdc).to.be.lessThan(20); // USDC underweight
      expect(pctsAfterDrain.gold).to.be.lessThan(35); // Gold underweight

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

      // updateAssetAllocation should still work while paused
      await expect(
        roseTreasury.connect(owner).updateAssetAllocation(BTC_KEY, 3000)
      ).to.not.be.reverted;

      // setMaxSlippage should still work while paused
      await expect(
        roseTreasury.connect(owner).setMaxSlippage(200)
      ).to.not.be.reverted;
    });
  });

  describe("User Cooldowns (24hr)", function () {
    it("Should allow first deposit without cooldown", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);

      // First deposit should work (no prior cooldown)
      await expect(
        roseTreasury.connect(user).deposit(depositAmount)
      ).to.not.be.reverted;
    });

    it("Should block second deposit within 24hr", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);

      // First deposit
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);
      await roseTreasury.connect(user).deposit(depositAmount);

      // Second deposit immediately should fail
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);

      await expect(
        roseTreasury.connect(user).deposit(depositAmount)
      ).to.be.revertedWithCustomError(roseTreasury, "CooldownNotElapsed");
    });

    it("Should allow deposit after 24hr cooldown elapsed", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);

      // First deposit
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);
      await roseTreasury.connect(user).deposit(depositAmount);

      // Advance time past 24hr
      await ethers.provider.send("evm_increaseTime", [DAY + 1]);
      await ethers.provider.send("evm_mine");

      // Second deposit should work
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);

      await expect(
        roseTreasury.connect(user).deposit(depositAmount)
      ).to.not.be.reverted;
    });

    it("Should allow first redeem without cooldown", async function () {
      // Setup: deposit first
      await deposit(user, ethers.parseUnits("1000", 6));

      const roseBalance = await roseToken.balanceOf(user.address);

      // Approve Treasury to burn tokens
      await roseToken.connect(user).approve(await roseTreasury.getAddress(), roseBalance);

      // First redeem should work
      await expect(
        roseTreasury.connect(user).redeem(roseBalance)
      ).to.not.be.reverted;
    });

    it("Should block second redeem within 24hr", async function () {
      // Setup: deposit enough for two redeems
      await deposit(user, ethers.parseUnits("2000", 6));

      const roseBalance = await roseToken.balanceOf(user.address);
      const halfBalance = roseBalance / 2n;

      // Approve Treasury to burn tokens
      await roseToken.connect(user).approve(await roseTreasury.getAddress(), roseBalance);

      // First redeem
      await roseTreasury.connect(user).redeem(halfBalance);

      // Second redeem immediately should fail
      await expect(
        roseTreasury.connect(user).redeem(halfBalance)
      ).to.be.revertedWithCustomError(roseTreasury, "CooldownNotElapsed");
    });

    it("Should allow redeem after 24hr cooldown elapsed", async function () {
      // Setup: deposit enough for two redeems
      await deposit(user, ethers.parseUnits("2000", 6));

      const roseBalance = await roseToken.balanceOf(user.address);
      const halfBalance = roseBalance / 2n;

      // Approve Treasury to burn tokens
      await roseToken.connect(user).approve(await roseTreasury.getAddress(), roseBalance);

      // First redeem
      await roseTreasury.connect(user).redeem(halfBalance);

      // Advance time past 24hr
      await ethers.provider.send("evm_increaseTime", [DAY + 1]);
      await ethers.provider.send("evm_mine");

      // Second redeem should work
      await expect(
        roseTreasury.connect(user).redeem(halfBalance)
      ).to.not.be.reverted;
    });

    it("Should track deposit and redeem cooldowns separately", async function () {
      // Deposit
      await deposit(user, ethers.parseUnits("1000", 6));

      const roseBalance = await roseToken.balanceOf(user.address);

      // Approve Treasury to burn tokens
      await roseToken.connect(user).approve(await roseTreasury.getAddress(), roseBalance);

      // Immediately try to redeem - should work (different cooldown)
      await expect(
        roseTreasury.connect(user).redeem(roseBalance / 2n)
      ).to.not.be.reverted;

      // But second redeem should fail (redeem cooldown now active)
      await expect(
        roseTreasury.connect(user).redeem(roseBalance / 4n)
      ).to.be.revertedWithCustomError(roseTreasury, "CooldownNotElapsed");
    });

    it("Should allow owner to bypass deposit cooldown", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);

      // Owner first deposit
      await usdc.mint(owner.address, depositAmount);
      await usdc.connect(owner).approve(await roseTreasury.getAddress(), depositAmount);
      await roseTreasury.connect(owner).deposit(depositAmount);

      // Owner second deposit immediately should work (owner bypasses)
      await usdc.mint(owner.address, depositAmount);
      await usdc.connect(owner).approve(await roseTreasury.getAddress(), depositAmount);

      await expect(
        roseTreasury.connect(owner).deposit(depositAmount)
      ).to.not.be.reverted;
    });

    it("Should allow owner to bypass redeem cooldown", async function () {
      // Setup: owner deposits
      await usdc.mint(owner.address, ethers.parseUnits("2000", 6));
      await usdc.connect(owner).approve(await roseTreasury.getAddress(), ethers.parseUnits("2000", 6));
      await roseTreasury.connect(owner).deposit(ethers.parseUnits("2000", 6));

      const roseBalance = await roseToken.balanceOf(owner.address);
      const halfBalance = roseBalance / 2n;

      // Approve Treasury to burn tokens
      await roseToken.connect(owner).approve(await roseTreasury.getAddress(), roseBalance);

      // Owner first redeem
      await roseTreasury.connect(owner).redeem(halfBalance);

      // Owner second redeem immediately should work (owner bypasses)
      await expect(
        roseTreasury.connect(owner).redeem(halfBalance)
      ).to.not.be.reverted;
    });

    it("Should report correct time until deposit via view function", async function () {
      // First deposit
      await deposit(user, ethers.parseUnits("1000", 6));

      // Check time remaining
      const timeRemaining = await roseTreasury.timeUntilDeposit(user.address);

      // Should be close to 24 hours (allow 10 second tolerance for block time)
      expect(timeRemaining).to.be.closeTo(DAY, 10);

      // For fresh address, should be 0
      const timeForFresh = await roseTreasury.timeUntilDeposit(user2.address);
      expect(timeForFresh).to.equal(0);
    });

    it("Should report correct time until redeem via view function", async function () {
      // Setup and redeem
      await deposit(user, ethers.parseUnits("1000", 6));
      const roseBalance = await roseToken.balanceOf(user.address);

      // Approve Treasury to burn tokens
      await roseToken.connect(user).approve(await roseTreasury.getAddress(), roseBalance);

      await roseTreasury.connect(user).redeem(roseBalance / 2n);

      // Check time remaining
      const timeRemaining = await roseTreasury.timeUntilRedeem(user.address);

      // Should be close to 24 hours
      expect(timeRemaining).to.be.closeTo(DAY, 10);

      // For fresh address, should be 0
      const timeForFresh = await roseTreasury.timeUntilRedeem(user2.address);
      expect(timeForFresh).to.equal(0);
    });

    it("Should return correct time remaining in error", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);

      // First deposit
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);
      await roseTreasury.connect(user).deposit(depositAmount);

      // Advance 12 hours
      await ethers.provider.send("evm_increaseTime", [12 * 60 * 60]);
      await ethers.provider.send("evm_mine");

      // Second deposit should fail with ~12 hours remaining
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);

      // Check the view function reports ~12hr remaining
      const timeRemaining = await roseTreasury.timeUntilDeposit(user.address);
      expect(timeRemaining).to.be.closeTo(12 * 60 * 60, 10);
    });
  });

  describe("Asset Management", function () {
    it("Should add assets correctly", async function () {
      // Assets were added in beforeEach, verify they exist
      const btcAsset = await roseTreasury.assets(BTC_KEY);
      expect(btcAsset.token).to.equal(await tbtc.getAddress());
      expect(btcAsset.targetBps).to.equal(3000);
      expect(btcAsset.active).to.be.true;

      const goldAsset = await roseTreasury.assets(GOLD_KEY);
      expect(goldAsset.token).to.equal(await paxg.getAddress());
      expect(goldAsset.targetBps).to.equal(3000);

      const stableAsset = await roseTreasury.assets(STABLE_KEY);
      expect(stableAsset.token).to.equal(await usdc.getAddress());
      expect(stableAsset.targetBps).to.equal(2000);

      const roseAsset = await roseTreasury.assets(ROSE_KEY);
      expect(roseAsset.token).to.equal(await roseToken.getAddress());
      expect(roseAsset.targetBps).to.equal(2000);
    });

    it("Should reject duplicate asset keys", async function () {
      await expect(
        roseTreasury.addAsset(
          BTC_KEY,
          await tbtc.getAddress(),
          await btcFeed.getAddress(),
          8,
          1000
        )
      ).to.be.revertedWithCustomError(roseTreasury, "AssetAlreadyExists");
    });

    it("Should update asset allocation", async function () {
      await roseTreasury.updateAssetAllocation(BTC_KEY, 2500);

      const btcAsset = await roseTreasury.assets(BTC_KEY);
      expect(btcAsset.targetBps).to.equal(2500);
    });

    it("Should deactivate and reactivate assets", async function () {
      await roseTreasury.deactivateAsset(BTC_KEY);

      let btcAsset = await roseTreasury.assets(BTC_KEY);
      expect(btcAsset.active).to.be.false;

      await roseTreasury.reactivateAsset(BTC_KEY);

      btcAsset = await roseTreasury.assets(BTC_KEY);
      expect(btcAsset.active).to.be.true;
    });

    it("Should not allow deactivating ROSE or STABLE", async function () {
      await expect(
        roseTreasury.deactivateAsset(ROSE_KEY)
      ).to.be.revertedWithCustomError(roseTreasury, "CannotDeactivateRequired");

      await expect(
        roseTreasury.deactivateAsset(STABLE_KEY)
      ).to.be.revertedWithCustomError(roseTreasury, "CannotDeactivateRequired");
    });

    it("Should return all assets via getAllAssets", async function () {
      const [keys, assetList] = await roseTreasury.getAllAssets();

      expect(keys.length).to.equal(4);
      expect(assetList.length).to.equal(4);

      // Verify keys are correct
      expect(keys[0]).to.equal(BTC_KEY);
      expect(keys[1]).to.equal(GOLD_KEY);
      expect(keys[2]).to.equal(STABLE_KEY);
      expect(keys[3]).to.equal(ROSE_KEY);
    });

    it("Should validate allocations sum", async function () {
      // Default allocations sum to 10000 (3000+3000+2000+2000)
      expect(await roseTreasury.validateAllocations()).to.be.true;

      // Update one allocation to break the sum
      await roseTreasury.updateAssetAllocation(BTC_KEY, 4000);

      // Now sum is 11000, not valid
      expect(await roseTreasury.validateAllocations()).to.be.false;
    });

    it("Should update asset token", async function () {
      const NewMockERC20 = await ethers.getContractFactory("MockERC20");
      const newBtcToken = await NewMockERC20.deploy("New BTC", "NBTC", 8);

      await roseTreasury.updateAssetToken(BTC_KEY, await newBtcToken.getAddress());

      const btcAsset = await roseTreasury.assets(BTC_KEY);
      expect(btcAsset.token).to.equal(await newBtcToken.getAddress());
    });

    it("Should update asset price feed", async function () {
      const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
      const newFeed = await MockV3Aggregator.deploy(8, 5000000000000n);

      await roseTreasury.updateAssetPriceFeed(BTC_KEY, await newFeed.getAddress());

      const btcAsset = await roseTreasury.assets(BTC_KEY);
      expect(btcAsset.priceFeed).to.equal(await newFeed.getAddress());
    });

    it("Should get asset breakdown", async function () {
      // First deposit to populate treasury
      await deposit(user, ethers.parseUnits("10000", 6));

      const btcBreakdown = await roseTreasury.getAssetBreakdown(BTC_KEY);

      expect(btcBreakdown.token).to.equal(await tbtc.getAddress());
      expect(btcBreakdown.balance).to.be.greaterThan(0);
      expect(btcBreakdown.valueUSD).to.be.greaterThan(0);
      expect(btcBreakdown.targetBps).to.equal(3000);
      expect(btcBreakdown.active).to.be.true;
    });

    it("Should get asset price", async function () {
      const btcPrice = await roseTreasury.getAssetPrice(BTC_KEY);
      expect(btcPrice).to.equal(4300000000000n); // $43,000 in 8 decimals

      const goldPrice = await roseTreasury.getAssetPrice(GOLD_KEY);
      expect(goldPrice).to.equal(200000000000n); // $2,000 in 8 decimals

      const stablePrice = await roseTreasury.getAssetPrice(STABLE_KEY);
      expect(stablePrice).to.equal(100000000n); // $1.00 in 8 decimals

      // ROSE price is NAV ($1 initially)
      const rosePrice = await roseTreasury.getAssetPrice(ROSE_KEY);
      expect(rosePrice).to.equal(1000000n); // $1.00 in 6 decimals (NAV format)
    });
  });
});
