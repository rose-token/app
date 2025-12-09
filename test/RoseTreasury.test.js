const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RoseTreasury with LiFi Integration", function () {
  let roseTreasury;
  let roseToken;
  let usdc;
  let tbtc;
  let paxg;
  let btcFeed;
  let xauFeed;
  let mockLiFi;
  let owner;
  let user;
  let user2;
  let rebalancer;

  // Asset keys as bytes32
  const BTC_KEY = ethers.encodeBytes32String("BTC");
  const GOLD_KEY = ethers.encodeBytes32String("GOLD");
  const STABLE_KEY = ethers.encodeBytes32String("STABLE");
  const ROSE_KEY = ethers.encodeBytes32String("ROSE");

  beforeEach(async function () {
    [owner, user, user2, rebalancer] = await ethers.getSigners();

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

    // 4. Deploy MockLiFiDiamond
    const MockLiFiDiamond = await ethers.getContractFactory("MockLiFiDiamond");
    mockLiFi = await MockLiFiDiamond.deploy();

    // 5. Set token decimals on MockLiFi
    await mockLiFi.setTokenDecimals(await usdc.getAddress(), 6);
    await mockLiFi.setTokenDecimals(await tbtc.getAddress(), 8);
    await mockLiFi.setTokenDecimals(await paxg.getAddress(), 18);
    await mockLiFi.setTokenDecimals(await roseToken.getAddress(), 18);

    // 6. Set exchange rates on MockLiFi (rate scaled by 1e18)
    // USDC (6 dec) -> BTC (8 dec): $1 USDC = 0.00002326 BTC at $43,000/BTC
    // Rate formula: 1 USDC (1e6) should give 2326 sats (0.00002326 BTC = 2326 in 8 decimals)
    // Rate = (outputPerInput * 1e18) / decimal_adjustment
    await mockLiFi.setExchangeRate(await usdc.getAddress(), await tbtc.getAddress(), 2326n * 10n**12n);
    // USDC -> PAXG: $1 USDC = 0.0005 PAXG at $2,000/oz
    await mockLiFi.setExchangeRate(await usdc.getAddress(), await paxg.getAddress(), 5n * 10n**26n);
    // USDC -> ROSE: 1:1
    await mockLiFi.setExchangeRate(await usdc.getAddress(), await roseToken.getAddress(), 1n * 10n**30n);

    // Also set reverse rates for redemptions/rebalancing
    await mockLiFi.setExchangeRate(await tbtc.getAddress(), await usdc.getAddress(), 43000n * 10n**16n);
    await mockLiFi.setExchangeRate(await paxg.getAddress(), await usdc.getAddress(), 2000n * 10n**6n);
    await mockLiFi.setExchangeRate(await roseToken.getAddress(), await usdc.getAddress(), 1n * 10n**6n);

    // 7. Fund MockLiFi with tokens for swaps (except ROSE - that would affect circulatingSupply)
    await tbtc.mint(await mockLiFi.getAddress(), ethers.parseUnits("1000", 8));
    await paxg.mint(await mockLiFi.getAddress(), ethers.parseUnits("100000", 18));
    await usdc.mint(await mockLiFi.getAddress(), ethers.parseUnits("10000000", 6));
    // Note: Don't mint ROSE to MockLiFi as it would make circulatingSupply > 0 with 0 hard assets

    // 8. Deploy RoseTreasury with MockLiFiDiamond
    const RoseTreasury = await ethers.getContractFactory("RoseTreasury");
    roseTreasury = await RoseTreasury.deploy(
      await roseToken.getAddress(),
      await usdc.getAddress(),
      await mockLiFi.getAddress()
    );

    // 9. Authorize Treasury on RoseToken
    await roseToken.setAuthorized(await roseTreasury.getAddress(), true);

    // 10. Set rebalancer
    await roseTreasury.setRebalancer(rebalancer.address);

    // 11. Register assets with addAsset()
    // BTC: 30%
    await roseTreasury.addAsset(
      BTC_KEY,
      await tbtc.getAddress(),
      await btcFeed.getAddress(),
      8,
      3000
    );

    // GOLD: 30%
    await roseTreasury.addAsset(
      GOLD_KEY,
      await paxg.getAddress(),
      await xauFeed.getAddress(),
      18,
      3000
    );

    // STABLE (USDC): 20%
    await roseTreasury.addAsset(
      STABLE_KEY,
      await usdc.getAddress(),
      ethers.ZeroAddress,
      6,
      2000
    );

    // ROSE: 20%
    await roseTreasury.addAsset(
      ROSE_KEY,
      await roseToken.getAddress(),
      ethers.ZeroAddress,
      18,
      2000
    );
  });

  // Helper constants
  const DAY = 24 * 60 * 60;

  // Helper to perform deposit (advances time if not first deposit from this address)
  async function deposit(signer, usdcAmount, skipTimeAdvance = false) {
    if (!skipTimeAdvance) {
      await ethers.provider.send("evm_increaseTime", [DAY + 1]);
      await ethers.provider.send("evm_mine");
    }
    await usdc.mint(signer.address, usdcAmount);
    await usdc.connect(signer).approve(await roseTreasury.getAddress(), usdcAmount);
    await roseTreasury.connect(signer).deposit(usdcAmount);
  }

  // Helper to generate LiFi swap calldata
  async function generateSwapCalldata(fromToken, toToken, amountIn, minAmountOut, recipient) {
    return await mockLiFi.encodeSwapCalldata(fromToken, toToken, amountIn, minAmountOut, recipient);
  }

  describe("Deposit (No Auto-Diversification)", function () {
    it("Should accept USDC and mint ROSE without diversifying", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      // User should have ROSE tokens
      const roseBalance = await roseToken.balanceOf(user.address);
      expect(roseBalance).to.be.greaterThan(0);

      // Treasury should have all USDC (no diversification)
      const treasuryUsdc = await usdc.balanceOf(await roseTreasury.getAddress());
      expect(treasuryUsdc).to.equal(depositAmount);

      // Treasury should have 0 BTC and 0 Gold (no auto-diversification)
      const treasuryBtc = await tbtc.balanceOf(await roseTreasury.getAddress());
      const treasuryGold = await paxg.balanceOf(await roseTreasury.getAddress());
      expect(treasuryBtc).to.equal(0);
      expect(treasuryGold).to.equal(0);
    });

    it("Should emit Deposited event", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);

      await expect(roseTreasury.connect(user).deposit(depositAmount))
        .to.emit(roseTreasury, "Deposited")
        .withArgs(user.address, depositAmount, ethers.parseUnits("1000", 18));
    });
  });

  describe("executeSwap (LiFi Integration)", function () {
    it("Should execute swap when called by rebalancer", async function () {
      // First deposit to get USDC in treasury
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      // Generate swap calldata: USDC -> BTC
      const swapAmount = ethers.parseUnits("3000", 6);
      const minOut = 1n;
      const lifiData = await generateSwapCalldata(
        await usdc.getAddress(),
        await tbtc.getAddress(),
        swapAmount,
        minOut,
        await roseTreasury.getAddress()
      );

      // Execute swap as rebalancer
      await roseTreasury.connect(rebalancer).executeSwap(
        STABLE_KEY,
        BTC_KEY,
        swapAmount,
        minOut,
        lifiData
      );

      // Treasury should now have some BTC
      const treasuryBtc = await tbtc.balanceOf(await roseTreasury.getAddress());
      expect(treasuryBtc).to.be.greaterThan(0);

      // Treasury USDC should be reduced
      const treasuryUsdc = await usdc.balanceOf(await roseTreasury.getAddress());
      expect(treasuryUsdc).to.equal(depositAmount - swapAmount);
    });

    it("Should execute swap when called by owner", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      const swapAmount = ethers.parseUnits("3000", 6);
      const minOut = 1n;
      const lifiData = await generateSwapCalldata(
        await usdc.getAddress(),
        await tbtc.getAddress(),
        swapAmount,
        minOut,
        await roseTreasury.getAddress()
      );

      // Owner can also call executeSwap
      await roseTreasury.connect(owner).executeSwap(
        STABLE_KEY,
        BTC_KEY,
        swapAmount,
        minOut,
        lifiData
      );

      const treasuryBtc = await tbtc.balanceOf(await roseTreasury.getAddress());
      expect(treasuryBtc).to.be.greaterThan(0);
    });

    it("Should revert when called by non-rebalancer", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      const swapAmount = ethers.parseUnits("3000", 6);
      const minOut = 1n;
      const lifiData = await generateSwapCalldata(
        await usdc.getAddress(),
        await tbtc.getAddress(),
        swapAmount,
        minOut,
        await roseTreasury.getAddress()
      );

      await expect(
        roseTreasury.connect(user).executeSwap(STABLE_KEY, BTC_KEY, swapAmount, minOut, lifiData)
      ).to.be.revertedWithCustomError(roseTreasury, "NotRebalancer");
    });

    it("Should emit SwapExecuted event", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      const swapAmount = ethers.parseUnits("3000", 6);
      const minOut = 1n;
      const lifiData = await generateSwapCalldata(
        await usdc.getAddress(),
        await tbtc.getAddress(),
        swapAmount,
        minOut,
        await roseTreasury.getAddress()
      );

      await expect(
        roseTreasury.connect(rebalancer).executeSwap(STABLE_KEY, BTC_KEY, swapAmount, minOut, lifiData)
      ).to.emit(roseTreasury, "SwapExecuted");
    });

    it("Should revert on slippage exceeded", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      const swapAmount = ethers.parseUnits("3000", 6);
      // Set minOut too high - MockLiFi will fail with slippage error which causes LiFiSwapFailed
      const minOut = ethers.parseUnits("1000", 8); // Way too high
      const lifiData = await generateSwapCalldata(
        await usdc.getAddress(),
        await tbtc.getAddress(),
        swapAmount,
        minOut,
        await roseTreasury.getAddress()
      );

      // MockLiFi reverts internally due to slippage, which manifests as LiFiSwapFailed in Treasury
      await expect(
        roseTreasury.connect(rebalancer).executeSwap(STABLE_KEY, BTC_KEY, swapAmount, minOut, lifiData)
      ).to.be.revertedWithCustomError(roseTreasury, "LiFiSwapFailed");
    });

    it("Should revert for invalid asset keys", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      const invalidKey = ethers.encodeBytes32String("INVALID");
      const swapAmount = ethers.parseUnits("3000", 6);
      const lifiData = await generateSwapCalldata(
        await usdc.getAddress(),
        await tbtc.getAddress(),
        swapAmount,
        1n,
        await roseTreasury.getAddress()
      );

      await expect(
        roseTreasury.connect(rebalancer).executeSwap(invalidKey, BTC_KEY, swapAmount, 1n, lifiData)
      ).to.be.revertedWithCustomError(roseTreasury, "AssetNotFound");
    });

    it("Should revert for inactive asset", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      // Deactivate BTC asset
      await roseTreasury.deactivateAsset(BTC_KEY);

      const swapAmount = ethers.parseUnits("3000", 6);
      const lifiData = await generateSwapCalldata(
        await usdc.getAddress(),
        await tbtc.getAddress(),
        swapAmount,
        1n,
        await roseTreasury.getAddress()
      );

      await expect(
        roseTreasury.connect(rebalancer).executeSwap(STABLE_KEY, BTC_KEY, swapAmount, 1n, lifiData)
      ).to.be.revertedWithCustomError(roseTreasury, "AssetNotActive");
    });

    it("Should revert for zero amount", async function () {
      const lifiData = await generateSwapCalldata(
        await usdc.getAddress(),
        await tbtc.getAddress(),
        0n,
        0n,
        await roseTreasury.getAddress()
      );

      await expect(
        roseTreasury.connect(rebalancer).executeSwap(STABLE_KEY, BTC_KEY, 0n, 0n, lifiData)
      ).to.be.revertedWithCustomError(roseTreasury, "ZeroAmount");
    });
  });

  describe("Redemption (Requires USDC Buffer)", function () {
    it("Should allow redemption when USDC buffer is sufficient", async function () {
      // Deposit first (skip time advance to avoid oracle staleness)
      const depositAmount = ethers.parseUnits("10000", 6);
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);
      await roseTreasury.connect(user).deposit(depositAmount);

      const roseBalance = await roseToken.balanceOf(user.address);

      // Redeem half - user must approve treasury to burn their ROSE tokens
      const redeemAmount = roseBalance / 2n;
      await roseToken.connect(user).approve(await roseTreasury.getAddress(), redeemAmount);

      await expect(
        roseTreasury.connect(user).redeem(redeemAmount)
      ).to.not.be.reverted;

      const usdcReceived = await usdc.balanceOf(user.address);
      expect(usdcReceived).to.be.greaterThan(0);
    });

    it("Should revert when USDC buffer is insufficient", async function () {
      // Deposit first
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      // Swap all USDC to BTC (simulating diversification)
      const treasuryUsdc = await usdc.balanceOf(await roseTreasury.getAddress());
      const lifiData = await generateSwapCalldata(
        await usdc.getAddress(),
        await tbtc.getAddress(),
        treasuryUsdc,
        1n,
        await roseTreasury.getAddress()
      );
      await roseTreasury.connect(rebalancer).executeSwap(
        STABLE_KEY,
        BTC_KEY,
        treasuryUsdc,
        1n,
        lifiData
      );

      // Now try to redeem - should fail due to insufficient USDC
      // User must approve treasury to burn their ROSE tokens
      const roseBalance = await roseToken.balanceOf(user.address);
      await roseToken.connect(user).approve(await roseTreasury.getAddress(), roseBalance);

      await expect(
        roseTreasury.connect(user).redeem(roseBalance)
      ).to.be.revertedWithCustomError(roseTreasury, "InsufficientLiquidity");
    });
  });

  describe("Rebalance and forceRebalance", function () {
    it("Should allow anyone to call rebalance when threshold met", async function () {
      // Setup: deposit and diversify to create drift
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      // Diversify everything to BTC (creates 100% drift from target)
      const treasuryUsdc = await usdc.balanceOf(await roseTreasury.getAddress());
      const lifiData = await generateSwapCalldata(
        await usdc.getAddress(),
        await tbtc.getAddress(),
        treasuryUsdc,
        1n,
        await roseTreasury.getAddress()
      );
      await roseTreasury.connect(rebalancer).executeSwap(STABLE_KEY, BTC_KEY, treasuryUsdc, 1n, lifiData);

      // Check needsRebalance
      expect(await roseTreasury.needsRebalance()).to.be.true;

      // Anyone can call rebalance
      await expect(roseTreasury.connect(user2).rebalance())
        .to.emit(roseTreasury, "Rebalanced");
    });

    it("Should revert rebalance if threshold not met", async function () {
      // Deposit and diversify to approximately match target allocation
      // Target: BTC 30%, GOLD 30%, USDC 20%, ROSE 20% (of total including ROSE)
      // Without diversification, vault is 100% USDC which IS drifted
      // So we need to diversify to get within threshold, AND have ROSE in treasury
      const depositAmount = ethers.parseUnits("10000", 6);
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);
      await roseTreasury.connect(user).deposit(depositAmount);

      // User got ~10000 ROSE minted. To balance ROSE at 20% of total:
      // NAV = hardAssets / circulatingSupply, and circulatingSupply = total - treasuryHeld
      // Let x = ROSE in treasury
      // roseValue = x * NAV = x * ($10000 / (10000 - x))
      // We want roseValue = 20% of total = 0.2 * ($10000 + roseValue)
      // Solving: x * 10000 / (10000 - x) = 0.2 * (10000 + x * 10000 / (10000 - x))
      // After algebra: x = 2000 ROSE tokens
      const roseForTreasury = ethers.parseUnits("2000", 18);
      await roseToken.connect(user).transfer(await roseTreasury.getAddress(), roseForTreasury);

      // Now: circulating = 8000 ROSE, NAV = $10000/8000 = $1.25
      // Treasury ROSE value = 2000 * $1.25 = $2500
      // Total = $10000 (hard) + $2500 (ROSE) = $12500
      // Targets: BTC 30% = $3750, Gold 30% = $3750, USDC 20% = $2500, ROSE 20% = $2500
      const btcAmount = ethers.parseUnits("3750", 6); // 30%
      const goldAmount = ethers.parseUnits("3750", 6); // 30%

      const btcData = await generateSwapCalldata(
        await usdc.getAddress(), await tbtc.getAddress(), btcAmount, 1n, await roseTreasury.getAddress()
      );
      const goldData = await generateSwapCalldata(
        await usdc.getAddress(), await paxg.getAddress(), goldAmount, 1n, await roseTreasury.getAddress()
      );

      await roseTreasury.connect(rebalancer).executeSwap(STABLE_KEY, BTC_KEY, btcAmount, 1n, btcData);
      await roseTreasury.connect(rebalancer).executeSwap(STABLE_KEY, GOLD_KEY, goldAmount, 1n, goldData);

      // Now vault should be balanced: BTC ~30%, Gold ~30%, USDC ~20%, ROSE ~20%
      await expect(
        roseTreasury.connect(user).rebalance()
      ).to.be.revertedWithCustomError(roseTreasury, "RebalanceNotNeeded");
    });

    it("Should enforce rebalance cooldown", async function () {
      // Setup drift
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      const treasuryUsdc = await usdc.balanceOf(await roseTreasury.getAddress());
      const lifiData = await generateSwapCalldata(
        await usdc.getAddress(),
        await tbtc.getAddress(),
        treasuryUsdc,
        1n,
        await roseTreasury.getAddress()
      );
      await roseTreasury.connect(rebalancer).executeSwap(STABLE_KEY, BTC_KEY, treasuryUsdc, 1n, lifiData);

      // First rebalance
      await roseTreasury.connect(user).rebalance();

      // Deposit more USDC to treasury to recreate conditions for rebalance
      await usdc.mint(await roseTreasury.getAddress(), ethers.parseUnits("10000", 6));

      // Second rebalance should fail due to cooldown
      await expect(
        roseTreasury.connect(user).rebalance()
      ).to.be.revertedWithCustomError(roseTreasury, "RebalanceCooldown");
    });

    it("Should allow rebalancer to forceRebalance", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      // forceRebalance works even if threshold not met
      await expect(roseTreasury.connect(rebalancer).forceRebalance())
        .to.emit(roseTreasury, "Rebalanced");
    });

    it("Should allow owner to forceRebalance", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      await expect(roseTreasury.connect(owner).forceRebalance())
        .to.emit(roseTreasury, "Rebalanced");
    });

    it("Should revert forceRebalance from non-rebalancer", async function () {
      await expect(
        roseTreasury.connect(user).forceRebalance()
      ).to.be.revertedWithCustomError(roseTreasury, "NotRebalancer");
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
      const depositAmount = ethers.parseUnits("1000", 6);
      await deposit(user, depositAmount);

      const roseBalance = await roseToken.balanceOf(user.address);
      // User must approve treasury to burn their ROSE tokens
      await roseToken.connect(user).approve(await roseTreasury.getAddress(), roseBalance);
      await roseTreasury.connect(owner).pause();

      await expect(
        roseTreasury.connect(user).redeem(roseBalance)
      ).to.be.revertedWithCustomError(roseTreasury, "EnforcedPause");
    });

    it("Should block executeSwap when paused", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      await roseTreasury.connect(owner).pause();

      const swapAmount = ethers.parseUnits("3000", 6);
      const lifiData = await generateSwapCalldata(
        await usdc.getAddress(),
        await tbtc.getAddress(),
        swapAmount,
        1n,
        await roseTreasury.getAddress()
      );

      await expect(
        roseTreasury.connect(rebalancer).executeSwap(STABLE_KEY, BTC_KEY, swapAmount, 1n, lifiData)
      ).to.be.revertedWithCustomError(roseTreasury, "EnforcedPause");
    });
  });

  describe("User Cooldowns (24hr)", function () {
    it("Should allow first deposit without cooldown", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);

      await expect(roseTreasury.connect(user).deposit(depositAmount)).to.not.be.reverted;
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

      await expect(roseTreasury.connect(user).deposit(depositAmount)).to.not.be.reverted;
    });

    it("Should allow owner to bypass deposit cooldown", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);

      // Owner first deposit
      await usdc.mint(owner.address, depositAmount);
      await usdc.connect(owner).approve(await roseTreasury.getAddress(), depositAmount);
      await roseTreasury.connect(owner).deposit(depositAmount);

      // Owner second deposit immediately should work
      await usdc.mint(owner.address, depositAmount);
      await usdc.connect(owner).approve(await roseTreasury.getAddress(), depositAmount);

      await expect(roseTreasury.connect(owner).deposit(depositAmount)).to.not.be.reverted;
    });
  });

  describe("Asset Management", function () {
    it("Should add assets correctly", async function () {
      const btcAsset = await roseTreasury.assets(BTC_KEY);
      expect(btcAsset.token).to.equal(await tbtc.getAddress());
      expect(btcAsset.targetBps).to.equal(3000);
      expect(btcAsset.active).to.be.true;
    });

    it("Should reject duplicate asset keys", async function () {
      await expect(
        roseTreasury.addAsset(BTC_KEY, await tbtc.getAddress(), await btcFeed.getAddress(), 8, 1000)
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
      expect(keys[0]).to.equal(BTC_KEY);
      expect(keys[1]).to.equal(GOLD_KEY);
      expect(keys[2]).to.equal(STABLE_KEY);
      expect(keys[3]).to.equal(ROSE_KEY);
    });

    it("Should validate allocations sum", async function () {
      // Default allocations sum to 10000
      expect(await roseTreasury.validateAllocations()).to.be.true;

      // Update one allocation to break the sum
      await roseTreasury.updateAssetAllocation(BTC_KEY, 4000);
      expect(await roseTreasury.validateAllocations()).to.be.false;
    });
  });

  describe("Rebalancer Management", function () {
    it("Should set rebalancer correctly", async function () {
      expect(await roseTreasury.rebalancer()).to.equal(rebalancer.address);

      await roseTreasury.setRebalancer(user2.address);
      expect(await roseTreasury.rebalancer()).to.equal(user2.address);
    });

    it("Should emit RebalancerUpdated event", async function () {
      await expect(roseTreasury.setRebalancer(user2.address))
        .to.emit(roseTreasury, "RebalancerUpdated")
        .withArgs(user2.address);
    });

    it("Should revert setRebalancer with zero address", async function () {
      await expect(
        roseTreasury.setRebalancer(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(roseTreasury, "ZeroAddress");
    });

    it("Should only allow owner to setRebalancer", async function () {
      await expect(
        roseTreasury.connect(user).setRebalancer(user2.address)
      ).to.be.revertedWithCustomError(roseTreasury, "OwnableUnauthorizedAccount");
    });
  });

  describe("NAV Calculations", function () {
    it("Should return $1.00 initial price when no deposits", async function () {
      const price = await roseTreasury.rosePrice();
      expect(price).to.equal(1000000n); // $1.00 in 6 decimals
    });

    it("Should maintain NAV after deposit", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      const price = await roseTreasury.rosePrice();
      // Should still be ~$1.00
      expect(price).to.be.closeTo(1000000n, 1000n);
    });

    it("Should calculate hardAssetValueUSD correctly", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      const hardAssets = await roseTreasury.hardAssetValueUSD();
      // All USDC, so should be deposit amount
      expect(hardAssets).to.equal(depositAmount);
    });
  });

  describe("View Functions", function () {
    it("Should return vault breakdown", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      const breakdown = await roseTreasury.getVaultBreakdown();
      expect(breakdown.totalHardAssets).to.equal(depositAmount);
      expect(breakdown.currentRosePrice).to.be.closeTo(1000000n, 1000n);
      expect(breakdown.circulatingRose).to.be.greaterThan(0);
    });

    it("Should return asset breakdown", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await deposit(user, depositAmount);

      const stableBreakdown = await roseTreasury.getAssetBreakdown(STABLE_KEY);
      expect(stableBreakdown.token).to.equal(await usdc.getAddress());
      expect(stableBreakdown.balance).to.equal(depositAmount);
      expect(stableBreakdown.valueUSD).to.equal(depositAmount);
    });

    it("Should return time until deposit/redeem", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.mint(user.address, depositAmount);
      await usdc.connect(user).approve(await roseTreasury.getAddress(), depositAmount);
      await roseTreasury.connect(user).deposit(depositAmount);

      const timeDeposit = await roseTreasury.timeUntilDeposit(user.address);
      expect(timeDeposit).to.be.closeTo(BigInt(DAY), 10n);

      const timeRedeem = await roseTreasury.timeUntilRedeem(user2.address);
      expect(timeRedeem).to.equal(0n);
    });
  });
});
