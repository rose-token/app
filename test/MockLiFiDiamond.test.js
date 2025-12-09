const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MockLiFiDiamond", function () {
  let mockLiFi;
  let tokenA;
  let tokenB;
  let tokenC;
  let owner;
  let user;
  let recipient;

  beforeEach(async function () {
    [owner, user, recipient] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20.deploy("Token A", "TKNA", 18);
    tokenB = await MockERC20.deploy("Token B", "TKNB", 6); // Different decimals
    tokenC = await MockERC20.deploy("Token C", "TKNC", 8);

    // Deploy MockLiFiDiamond
    const MockLiFiDiamond = await ethers.getContractFactory("MockLiFiDiamond");
    mockLiFi = await MockLiFiDiamond.deploy();

    // Set token decimals
    await mockLiFi.setTokenDecimals(await tokenA.getAddress(), 18);
    await mockLiFi.setTokenDecimals(await tokenB.getAddress(), 6);
    await mockLiFi.setTokenDecimals(await tokenC.getAddress(), 8);

    // Mint tokens to user for testing
    await tokenA.mint(user.address, ethers.parseUnits("10000", 18));
    await tokenB.mint(user.address, ethers.parseUnits("10000", 6));
    await tokenC.mint(user.address, ethers.parseUnits("10000", 8));

    // Fund mock LiFi with output tokens
    await tokenA.mint(await mockLiFi.getAddress(), ethers.parseUnits("100000", 18));
    await tokenB.mint(await mockLiFi.getAddress(), ethers.parseUnits("100000", 6));
    await tokenC.mint(await mockLiFi.getAddress(), ethers.parseUnits("100000", 8));
  });

  describe("Exchange Rate Management", function () {
    it("Should set and retrieve exchange rates", async function () {
      const rate = ethers.parseUnits("2", 18); // 2:1 ratio
      await mockLiFi.setExchangeRate(await tokenA.getAddress(), await tokenB.getAddress(), rate);

      const storedRate = await mockLiFi.exchangeRates(await tokenA.getAddress(), await tokenB.getAddress());
      expect(storedRate).to.equal(rate);
    });

    it("Should emit ExchangeRateSet event", async function () {
      const rate = ethers.parseUnits("1.5", 18);
      await expect(mockLiFi.setExchangeRate(await tokenA.getAddress(), await tokenB.getAddress(), rate))
        .to.emit(mockLiFi, "ExchangeRateSet")
        .withArgs(await tokenA.getAddress(), await tokenB.getAddress(), rate);
    });

    it("Should set token decimals", async function () {
      const newToken = await (await ethers.getContractFactory("MockERC20")).deploy("New", "NEW", 12);
      await mockLiFi.setTokenDecimals(await newToken.getAddress(), 12);

      const decimals = await mockLiFi.tokenDecimals(await newToken.getAddress());
      expect(decimals).to.equal(12);
    });
  });

  describe("swapSimple Function", function () {
    it("Should execute swap with default 1:1 rate (same decimals)", async function () {
      const amountIn = ethers.parseUnits("100", 18);
      const minOut = ethers.parseUnits("99", 18); // Allow some slippage

      await tokenA.connect(user).approve(await mockLiFi.getAddress(), amountIn);

      const balBefore = await tokenA.balanceOf(recipient.address);
      await mockLiFi.connect(user).swapSimple(
        await tokenA.getAddress(),
        await tokenA.getAddress(), // Same token, 1:1
        amountIn,
        minOut,
        recipient.address
      );

      const balAfter = await tokenA.balanceOf(recipient.address);
      expect(balAfter - balBefore).to.equal(amountIn);
    });

    it("Should execute swap with custom exchange rate", async function () {
      // Set rate: 1 TokenA = 2 TokenA (same decimals, 2:1 ratio)
      // Note: Rate is applied as (amountIn * rate) / 1e18, so for cross-decimal
      // swaps, the rate must account for decimal differences
      const rate = ethers.parseUnits("2", 18); // 2:1 ratio
      await mockLiFi.setExchangeRate(await tokenA.getAddress(), await tokenA.getAddress(), rate);

      const amountIn = ethers.parseUnits("100", 18);
      const expectedOut = (amountIn * rate) / ethers.parseUnits("1", 18); // 200e18

      await tokenA.connect(user).approve(await mockLiFi.getAddress(), amountIn);

      const balBefore = await tokenA.balanceOf(recipient.address);
      await mockLiFi.connect(user).swapSimple(
        await tokenA.getAddress(),
        await tokenA.getAddress(),
        amountIn,
        expectedOut,
        recipient.address
      );

      const balAfter = await tokenA.balanceOf(recipient.address);
      expect(balAfter - balBefore).to.equal(expectedOut);
    });

    it("Should execute swap with rate accounting for decimal differences", async function () {
      // TokenA: 18 decimals, TokenB: 6 decimals
      // For cross-decimal swaps with a rate, the rate must account for both:
      // 1. The desired exchange ratio (e.g., 2:1)
      // 2. The decimal difference (18 - 6 = 12 decimals)
      // Rate formula: desiredRatio * 10^(toDecimals - fromDecimals) * 1e18 / 1e18
      // For 2:1 ratio from 18 to 6 decimals: 2 * 10^(6-18) * 1e18 = 2e6
      const rate = ethers.parseUnits("2", 6); // 2:1 ratio, adjusted for 18→6 decimals

      await mockLiFi.setExchangeRate(await tokenA.getAddress(), await tokenB.getAddress(), rate);

      const amountIn = ethers.parseUnits("100", 18); // 100 TokenA
      const expectedOut = (amountIn * rate) / ethers.parseUnits("1", 18); // 200e6 = 200 TokenB

      await tokenA.connect(user).approve(await mockLiFi.getAddress(), amountIn);

      const balBefore = await tokenB.balanceOf(recipient.address);
      await mockLiFi.connect(user).swapSimple(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountIn,
        expectedOut,
        recipient.address
      );

      const balAfter = await tokenB.balanceOf(recipient.address);
      expect(balAfter - balBefore).to.equal(expectedOut);
      expect(expectedOut).to.equal(ethers.parseUnits("200", 6)); // Verify we got 200 TokenB
    });

    it("Should adjust for decimal differences (no rate set)", async function () {
      // TokenA: 18 decimals, TokenB: 6 decimals
      // 1e18 TokenA → 1e6 TokenB (1:1 value, adjusted for decimals)
      const amountIn = ethers.parseUnits("100", 18); // 100 * 1e18
      const expectedOut = ethers.parseUnits("100", 6); // 100 * 1e6

      await tokenA.connect(user).approve(await mockLiFi.getAddress(), amountIn);

      const balBefore = await tokenB.balanceOf(recipient.address);
      await mockLiFi.connect(user).swapSimple(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountIn,
        expectedOut,
        recipient.address
      );

      const balAfter = await tokenB.balanceOf(recipient.address);
      expect(balAfter - balBefore).to.equal(expectedOut);
    });

    it("Should revert on slippage exceeded", async function () {
      const amountIn = ethers.parseUnits("100", 18);
      const unreasonableMinOut = ethers.parseUnits("1000", 18); // Too high

      await tokenA.connect(user).approve(await mockLiFi.getAddress(), amountIn);

      await expect(
        mockLiFi.connect(user).swapSimple(
          await tokenA.getAddress(),
          await tokenA.getAddress(),
          amountIn,
          unreasonableMinOut,
          recipient.address
        )
      ).to.be.revertedWith("Slippage exceeded");
    });

    it("Should revert with invalid fromToken", async function () {
      const amountIn = ethers.parseUnits("100", 18);

      await expect(
        mockLiFi.connect(user).swapSimple(
          ethers.ZeroAddress,
          await tokenA.getAddress(),
          amountIn,
          amountIn,
          recipient.address
        )
      ).to.be.revertedWith("Invalid fromToken");
    });

    it("Should revert with invalid recipient", async function () {
      const amountIn = ethers.parseUnits("100", 18);

      await tokenA.connect(user).approve(await mockLiFi.getAddress(), amountIn);

      await expect(
        mockLiFi.connect(user).swapSimple(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          amountIn,
          0,
          ethers.ZeroAddress
        )
      ).to.be.revertedWith("Invalid recipient");
    });

    it("Should revert with zero amount", async function () {
      await expect(
        mockLiFi.connect(user).swapSimple(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          0,
          0,
          recipient.address
        )
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("Should emit SwapExecuted event", async function () {
      const amountIn = ethers.parseUnits("100", 18);

      await tokenA.connect(user).approve(await mockLiFi.getAddress(), amountIn);

      await expect(
        mockLiFi.connect(user).swapSimple(
          await tokenA.getAddress(),
          await tokenA.getAddress(),
          amountIn,
          amountIn,
          recipient.address
        )
      )
        .to.emit(mockLiFi, "SwapExecuted")
        .withArgs(
          await tokenA.getAddress(),
          await tokenA.getAddress(),
          amountIn,
          amountIn,
          recipient.address
        );
    });
  });

  describe("Fallback Function", function () {
    it("Should execute swap via fallback with encoded calldata", async function () {
      const amountIn = ethers.parseUnits("50", 18);
      const minOut = ethers.parseUnits("50", 18);

      await tokenA.connect(user).approve(await mockLiFi.getAddress(), amountIn);

      // Generate calldata using helper function
      const calldata = await mockLiFi.encodeSwapCalldata(
        await tokenA.getAddress(),
        await tokenA.getAddress(),
        amountIn,
        minOut,
        recipient.address
      );

      const balBefore = await tokenA.balanceOf(recipient.address);

      // Call via low-level call (simulates how Treasury will call LiFi)
      const tx = await user.sendTransaction({
        to: await mockLiFi.getAddress(),
        data: calldata,
      });
      await tx.wait();

      const balAfter = await tokenA.balanceOf(recipient.address);
      expect(balAfter - balBefore).to.equal(amountIn);
    });

    it("Should execute swap via fallback with raw encoded params", async function () {
      const amountIn = ethers.parseUnits("75", 18);
      const minOut = ethers.parseUnits("75", 18);

      await tokenA.connect(user).approve(await mockLiFi.getAddress(), amountIn);

      // Raw encode without function selector
      const rawCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "uint256", "address"],
        [await tokenA.getAddress(), await tokenA.getAddress(), amountIn, minOut, recipient.address]
      );

      const balBefore = await tokenA.balanceOf(recipient.address);

      const tx = await user.sendTransaction({
        to: await mockLiFi.getAddress(),
        data: rawCalldata,
      });
      await tx.wait();

      const balAfter = await tokenA.balanceOf(recipient.address);
      expect(balAfter - balBefore).to.equal(amountIn);
    });
  });

  describe("Swap History", function () {
    it("Should record swap history", async function () {
      const amountIn = ethers.parseUnits("100", 18);

      await tokenA.connect(user).approve(await mockLiFi.getAddress(), amountIn);
      await mockLiFi.connect(user).swapSimple(
        await tokenA.getAddress(),
        await tokenA.getAddress(),
        amountIn,
        amountIn,
        recipient.address
      );

      const count = await mockLiFi.getSwapCount();
      expect(count).to.equal(1);

      const [fromToken, toToken, recordedAmountIn, amountOut, recordedRecipient, timestamp] =
        await mockLiFi.getSwap(0);

      expect(fromToken).to.equal(await tokenA.getAddress());
      expect(toToken).to.equal(await tokenA.getAddress());
      expect(recordedAmountIn).to.equal(amountIn);
      expect(amountOut).to.equal(amountIn);
      expect(recordedRecipient).to.equal(recipient.address);
      expect(timestamp).to.be.gt(0);
    });

    it("Should get last swap", async function () {
      const amount1 = ethers.parseUnits("100", 18);
      const amount2 = ethers.parseUnits("200", 18);

      await tokenA.connect(user).approve(await mockLiFi.getAddress(), amount1 + amount2);

      await mockLiFi.connect(user).swapSimple(
        await tokenA.getAddress(),
        await tokenA.getAddress(),
        amount1,
        amount1,
        recipient.address
      );

      await mockLiFi.connect(user).swapSimple(
        await tokenA.getAddress(),
        await tokenA.getAddress(),
        amount2,
        amount2,
        recipient.address
      );

      const [, , lastAmountIn, , , ] = await mockLiFi.getLastSwap();
      expect(lastAmountIn).to.equal(amount2);
    });

    it("Should clear swap history", async function () {
      const amountIn = ethers.parseUnits("100", 18);

      await tokenA.connect(user).approve(await mockLiFi.getAddress(), amountIn);
      await mockLiFi.connect(user).swapSimple(
        await tokenA.getAddress(),
        await tokenA.getAddress(),
        amountIn,
        amountIn,
        recipient.address
      );

      expect(await mockLiFi.getSwapCount()).to.equal(1);

      await mockLiFi.clearSwapHistory();

      expect(await mockLiFi.getSwapCount()).to.equal(0);
    });

    it("Should revert getSwap with out of bounds index", async function () {
      await expect(mockLiFi.getSwap(0)).to.be.revertedWith("Index out of bounds");
    });

    it("Should revert getLastSwap with no swaps", async function () {
      await expect(mockLiFi.getLastSwap()).to.be.revertedWith("No swaps recorded");
    });
  });

  describe("Quote Function", function () {
    it("Should return quote without executing swap", async function () {
      const rate = ethers.parseUnits("3", 18); // 3:1 ratio
      await mockLiFi.setExchangeRate(await tokenA.getAddress(), await tokenB.getAddress(), rate);

      const amountIn = ethers.parseUnits("100", 18);
      const expectedOut = (amountIn * rate) / ethers.parseUnits("1", 18);

      const quote = await mockLiFi.getQuote(await tokenA.getAddress(), await tokenB.getAddress(), amountIn);

      expect(quote).to.equal(expectedOut);

      // Verify no swap was recorded
      expect(await mockLiFi.getSwapCount()).to.equal(0);
    });

    it("Should return decimal-adjusted quote with no rate", async function () {
      // TokenA: 18 decimals, TokenC: 8 decimals
      const amountIn = ethers.parseUnits("100", 18);
      const expectedOut = ethers.parseUnits("100", 8);

      const quote = await mockLiFi.getQuote(await tokenA.getAddress(), await tokenC.getAddress(), amountIn);

      expect(quote).to.equal(expectedOut);
    });
  });

  describe("Encode Calldata Helper", function () {
    it("Should generate valid calldata for swapSimple", async function () {
      const amountIn = ethers.parseUnits("100", 18);
      const minOut = ethers.parseUnits("99", 18);

      const calldata = await mockLiFi.encodeSwapCalldata(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountIn,
        minOut,
        recipient.address
      );

      // Verify it starts with the correct selector
      const expectedSelector = mockLiFi.interface.getFunction("swapSimple").selector;
      expect(calldata.slice(0, 10)).to.equal(expectedSelector);
    });
  });

  describe("Integration: Treasury-like Usage", function () {
    it("Should work as Treasury's executeSwap target", async function () {
      // Simulate how Treasury will use MockLiFiDiamond
      // 1. Treasury approves LiFi to spend tokens
      // 2. Treasury calls LiFi with backend-generated calldata
      // 3. LiFi executes swap and sends output to Treasury

      const treasury = user; // Simulate treasury as user
      const amountIn = ethers.parseUnits("1000", 18);

      // Set exchange rate: 1.5:1 ratio
      // Note: Using same token means balance change = output - input
      const rate = ethers.parseUnits("1.5", 18);
      await mockLiFi.setExchangeRate(await tokenA.getAddress(), await tokenA.getAddress(), rate);

      const expectedOut = (amountIn * rate) / ethers.parseUnits("1", 18); // 1500e18
      const expectedNetChange = expectedOut - amountIn; // 500e18 (gain 1500, lose 1000)
      const minOut = expectedOut;

      // Treasury approves LiFi
      await tokenA.connect(treasury).approve(await mockLiFi.getAddress(), amountIn);

      // Generate calldata (backend would do this)
      const calldata = await mockLiFi.encodeSwapCalldata(
        await tokenA.getAddress(),
        await tokenA.getAddress(),
        amountIn,
        minOut,
        treasury.address // Treasury receives output
      );

      const balBefore = await tokenA.balanceOf(treasury.address);

      // Treasury executes: lifiDiamond.call(lifiData)
      const tx = await treasury.sendTransaction({
        to: await mockLiFi.getAddress(),
        data: calldata,
      });
      await tx.wait();

      const balAfter = await tokenA.balanceOf(treasury.address);
      // When swapping same token, net change = output - input
      expect(balAfter - balBefore).to.equal(expectedNetChange);

      // Verify swap was recorded correctly
      const [fromToken, toToken, recordedIn, recordedOut, , ] = await mockLiFi.getLastSwap();
      expect(recordedIn).to.equal(amountIn);
      expect(recordedOut).to.equal(expectedOut);
    });

    it("Should work with cross-decimal tokens (USDC to BTC simulation)", async function () {
      // Simulate Treasury swapping USDC (6 dec) for tBTC (8 dec)
      // This matches RoseTreasury's actual use case
      const treasury = user;
      const amountIn = ethers.parseUnits("1000", 6); // 1000 USDC

      // Set rate: 1 USDC (6 dec) = 0.000023 tBTC (8 dec) at ~$43000 BTC
      // Rate formula: desiredBTCperUSDC * 10^(8-6) * 1e18 = 0.000023 * 1e20 = 2.3e15
      const rate = ethers.parseUnits("0.000023", 20); // Results in 8-decimal output

      await mockLiFi.setExchangeRate(await tokenB.getAddress(), await tokenC.getAddress(), rate);

      const expectedOut = (amountIn * rate) / ethers.parseUnits("1", 18); // ~0.023 tBTC in 8 decimals

      await tokenB.connect(treasury).approve(await mockLiFi.getAddress(), amountIn);

      // Generate calldata
      const calldata = await mockLiFi.encodeSwapCalldata(
        await tokenB.getAddress(), // USDC-like (6 dec)
        await tokenC.getAddress(), // tBTC-like (8 dec)
        amountIn,
        expectedOut,
        treasury.address
      );

      const balBefore = await tokenC.balanceOf(treasury.address);

      const tx = await treasury.sendTransaction({
        to: await mockLiFi.getAddress(),
        data: calldata,
      });
      await tx.wait();

      const balAfter = await tokenC.balanceOf(treasury.address);
      expect(balAfter - balBefore).to.equal(expectedOut);
    });
  });

  describe("Receive ETH", function () {
    it("Should accept ETH via receive", async function () {
      const amount = ethers.parseEther("1");

      await expect(
        owner.sendTransaction({
          to: await mockLiFi.getAddress(),
          value: amount,
        })
      ).to.not.be.reverted;

      const balance = await ethers.provider.getBalance(await mockLiFi.getAddress());
      expect(balance).to.equal(amount);
    });
  });
});
