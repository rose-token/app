import { ethers } from 'ethers';
import { config } from '../config';
import { getWsProvider } from '../utils/wsProvider';

// LiFi API endpoint
const LIFI_API_BASE = 'https://li.quest/v1';

// Arbitrum chain ID
const ARBITRUM_CHAIN_ID = 42161;
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

/**
 * Check if running on testnet (Sepolia)
 * LiFi API only supports mainnet chains
 */
export function isTestnet(): boolean {
  const rpcUrl = config.rpc.url.toLowerCase();
  return rpcUrl.includes('sepolia') || rpcUrl.includes('testnet');
}

/**
 * Generate mock swap calldata for MockLiFiDiamond on testnet
 * The mock uses swapSimple(address,address,uint256,uint256,address)
 */
function generateMockSwapData(
  fromToken: string,
  toToken: string,
  amountIn: bigint,
  minAmountOut: bigint,
  recipient: string
): string {
  const iface = new ethers.Interface([
    'function swapSimple(address fromToken, address toToken, uint256 amountIn, uint256 minAmountOut, address recipient)'
  ]);
  return iface.encodeFunctionData('swapSimple', [
    fromToken, toToken, amountIn, minAmountOut, recipient
  ]);
}


/**
 * Calculate swap output by querying MockLiFiDiamond.getQuote()
 * This ensures the expected output matches what MockLiFi will actually produce,
 * avoiding slippage failures from price mismatches between Chainlink and MockLiFi rates.
 */
async function calculateMockSwapOutput(
  fromToken: string,
  toToken: string,
  amountIn: bigint,
  treasuryAddress: string
): Promise<bigint> {
  const provider = getWsProvider();

  // Get lifiDiamond address from Treasury contract (it's immutable)
  const treasuryAbi = ['function lifiDiamond() view returns (address)'];
  const treasury = new ethers.Contract(treasuryAddress, treasuryAbi, provider);
  const lifiDiamondAddr = await treasury.lifiDiamond();

  // Query MockLiFiDiamond for exact output
  const mockLiFiAbi = ['function getQuote(address fromToken, address toToken, uint256 amountIn) view returns (uint256)'];
  const mockLiFi = new ethers.Contract(lifiDiamondAddr, mockLiFiAbi, provider);

  try {
    const output = await mockLiFi.getQuote(fromToken, toToken, amountIn);
    console.log(`[LiFi] MockLiFi quote: ${fromToken} -> ${toToken}`);
    console.log(`[LiFi] Input: ${amountIn.toString()} -> Output: ${output.toString()}`);
    return output;
  } catch (err) {
    console.warn(`[LiFi] getQuote failed, using 1:1 fallback:`, err);
    return amountIn; // Fallback
  }
}

interface LiFiQuoteParams {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  slippage?: number;
}

interface LiFiQuoteResponse {
  transactionRequest: {
    to: string;
    data: string;
    value: string;
    gasLimit: string;
    gasPrice?: string;
  };
  estimate: {
    fromAmount: string;
    toAmount: string;
    toAmountMin: string;
    gasCosts: { amount: string }[];
    feeCosts: { amount: string }[];
  };
  action: {
    fromToken: { address: string; symbol: string; decimals: number };
    toToken: { address: string; symbol: string; decimals: number };
  };
}

/**
 * Get the chain ID based on RPC URL
 */
function getChainId(): number {
  const rpcUrl = config.rpc.url.toLowerCase();
  if (rpcUrl.includes('sepolia')) {
    return ARBITRUM_SEPOLIA_CHAIN_ID;
  }
  return ARBITRUM_CHAIN_ID;
}

/**
 * Get a swap quote from LiFi API (mainnet) or generate mock data (testnet)
 */
export async function getSwapQuote(
  fromToken: string,
  toToken: string,
  amountIn: bigint,
  treasuryAddress: string,
  slippageBps: number = 100 // 1% default
): Promise<{
  lifiData: string;
  minAmountOut: bigint;
  estimatedAmountOut: bigint;
  gasCost: bigint;
  gasLimit: bigint;
}> {
  // On testnet, generate mock calldata for MockLiFiDiamond
  // LiFi API only supports mainnet chains
  if (isTestnet()) {
    console.log(`[LiFi] Testnet detected - generating mock swap data with oracle prices`);

    // Calculate realistic output using mock Chainlink prices
    const estimatedAmountOut = await calculateMockSwapOutput(
      fromToken,
      toToken,
      amountIn,
      treasuryAddress
    );

    // Apply slippage to minAmountOut
    const minAmountOut = (estimatedAmountOut * BigInt(10000 - slippageBps)) / 10000n;

    const lifiData = generateMockSwapData(
      fromToken,
      toToken,
      amountIn,
      minAmountOut,
      treasuryAddress
    );

    console.log(`[LiFi] Mock swap: ${fromToken} -> ${toToken}`);
    console.log(`[LiFi] Amount in: ${amountIn.toString()}, Expected out: ${estimatedAmountOut.toString()}, Min out: ${minAmountOut.toString()}`);

    return {
      lifiData,
      minAmountOut,
      estimatedAmountOut,
      gasCost: 0n,
      gasLimit: 500000n, // Safe default for mock swaps
    };
  }

  // Mainnet: call LiFi API
  const chainId = getChainId();

  const params: LiFiQuoteParams = {
    fromChain: chainId,
    toChain: chainId,
    fromToken,
    toToken,
    fromAmount: amountIn.toString(),
    fromAddress: treasuryAddress,
    slippage: slippageBps / 10000, // LiFi uses decimal (0.01 = 1%)
  };

  const queryParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    queryParams[k] = String(v);
  }
  const queryString = new URLSearchParams(queryParams).toString();

  const response = await fetch(`${LIFI_API_BASE}/quote?${queryString}`);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LiFi quote failed: ${error}`);
  }

  const quote = (await response.json()) as LiFiQuoteResponse;

  // Calculate min amount out with slippage
  const estimatedAmountOut = BigInt(quote.estimate.toAmount);
  const minAmountOut = BigInt(quote.estimate.toAmountMin);

  // Calculate total gas cost
  const gasCost = quote.estimate.gasCosts.reduce(
    (sum, cost) => sum + BigInt(cost.amount),
    0n
  );

  // Parse gasLimit from quote
  const gasLimit = BigInt(quote.transactionRequest.gasLimit || '500000');

  console.log(
    `[LiFi] Quote: ${ethers.formatUnits(amountIn, quote.action.fromToken.decimals)} ${quote.action.fromToken.symbol} -> ` +
      `${ethers.formatUnits(estimatedAmountOut, quote.action.toToken.decimals)} ${quote.action.toToken.symbol}, ` +
      `gasLimit: ${gasLimit.toString()}`
  );

  return {
    lifiData: quote.transactionRequest.data,
    minAmountOut,
    estimatedAmountOut,
    gasCost,
    gasLimit,
  };
}

/**
 * Calculate the min amount out with slippage applied
 */
export function applySlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10000 - slippageBps)) / 10000n;
}

/**
 * Calculate diversification swaps with smart rebalancing.
 * Prioritizes underweight assets (USDC buffer first, then RWA proportionally).
 * Only uses target ratios for excess after all deficits are filled.
 * Note: Does NOT buy ROSE - that's handled by rebalance() buybacks.
 *
 * @param depositAmountUsdc - USDC deposited (6 decimals)
 * @param targetAllocations - Map of asset key to target bps
 * @param currentBalances - Map of asset key to current USD value (6 decimals)
 * @returns Array of swap instructions
 */
export function calculateDiversificationSwaps(
  depositAmountUsdc: bigint,
  targetAllocations: Map<string, number>,
  currentBalances: Map<string, bigint>
): { assetKey: string; usdcAmount: bigint }[] {
  const swaps: { assetKey: string; usdcAmount: bigint }[] = [];

  // Get current balances (post-deposit - fetched after deposit event)
  const currentBTC = currentBalances.get('BTC') ?? 0n;
  const currentGOLD = currentBalances.get('GOLD') ?? 0n;
  const currentUSDC = currentBalances.get('STABLE') ?? 0n; // Already includes deposit

  // Pre-deposit USDC = current minus the deposit we just received
  const preDepositUSDC = currentUSDC - depositAmountUsdc;

  // First deposit - use simple ratio split to RWA only
  if (currentBTC === 0n && currentGOLD === 0n && preDepositUSDC === 0n) {
    return diversifyByRatio(depositAmountUsdc, targetAllocations);
  }

  // Get allocation percentages (in basis points, out of 10000 total)
  const allocBTC = targetAllocations.get('BTC') ?? 0;
  const allocGOLD = targetAllocations.get('GOLD') ?? 0;
  const allocUSDC = targetAllocations.get('STABLE') ?? 0;

  if (allocBTC === 0 && allocGOLD === 0 && allocUSDC === 0) return swaps;

  // Total hard assets (currentUSDC already includes deposit, don't add again)
  const newHardTotal = currentBTC + currentGOLD + currentUSDC;

  // Target values using allocation percentages directly (not rescaled)
  // The 20% ROSE allocation provides headroom without affecting BTC/GOLD/USDC ratios
  const targetBTC = (newHardTotal * BigInt(allocBTC)) / 10000n;
  const targetGOLD = (newHardTotal * BigInt(allocGOLD)) / 10000n;
  const targetUSDC = (newHardTotal * BigInt(allocUSDC)) / 10000n;

  // Calculate deficits
  const deficitUSDC = targetUSDC > preDepositUSDC ? targetUSDC - preDepositUSDC : 0n;
  const deficitBTC = targetBTC > currentBTC ? targetBTC - currentBTC : 0n;
  const deficitGOLD = targetGOLD > currentGOLD ? targetGOLD - currentGOLD : 0n;

  let remaining = depositAmountUsdc;

  // Phase 1: Fill USDC buffer first (critical for redemption liquidity)
  if (deficitUSDC > 0n && remaining > 0n) {
    const toUSDC = remaining < deficitUSDC ? remaining : deficitUSDC;
    remaining -= toUSDC;
    // USDC stays in contract, no swap needed
    console.log(`[LiFi] Phase 1: Keeping ${ethers.formatUnits(toUSDC, 6)} USDC for buffer`);
  }

  // Phase 2: Fill RWA deficits proportionally
  if (remaining > 0n) {
    const totalRWADeficit = deficitBTC + deficitGOLD;

    if (totalRWADeficit > 0n) {
      const toSpend = remaining < totalRWADeficit ? remaining : totalRWADeficit;

      if (deficitBTC > 0n) {
        const spentBTC = (toSpend * deficitBTC) / totalRWADeficit;
        if (spentBTC > 0n) {
          swaps.push({ assetKey: 'BTC', usdcAmount: spentBTC });
          console.log(`[LiFi] Phase 2: ${ethers.formatUnits(spentBTC, 6)} USDC -> BTC (deficit fill)`);
        }
      }
      if (deficitGOLD > 0n) {
        const spentGOLD = toSpend - ((toSpend * deficitBTC) / totalRWADeficit);
        if (spentGOLD > 0n) {
          swaps.push({ assetKey: 'GOLD', usdcAmount: spentGOLD });
          console.log(`[LiFi] Phase 2: ${ethers.formatUnits(spentGOLD, 6)} USDC -> GOLD (deficit fill)`);
        }
      }

      remaining -= toSpend;
    }
  }

  // Phase 3: Excess goes to RWA by ratio
  if (remaining > 0n) {
    console.log(`[LiFi] Phase 3: ${ethers.formatUnits(remaining, 6)} USDC excess -> RWA by ratio`);
    const ratioSwaps = diversifyByRatio(remaining, targetAllocations);
    swaps.push(...ratioSwaps);
  }

  return swaps;
}

/**
 * Simple ratio-based diversification for first deposit or excess funds
 * Splits between BTC, GOLD, and keeps USDC buffer proportionally
 * (matches Solidity _diversifyByRatio behavior)
 */
function diversifyByRatio(
  amount: bigint,
  targetAllocations: Map<string, number>
): { assetKey: string; usdcAmount: bigint }[] {
  const swaps: { assetKey: string; usdcAmount: bigint }[] = [];

  const allocBTC = targetAllocations.get('BTC') ?? 0;
  const allocGOLD = targetAllocations.get('GOLD') ?? 0;
  const allocUSDC = targetAllocations.get('STABLE') ?? 0;
  
  // Include USDC in the denominator so we keep proportional buffer
  const hardAllocTotal = allocBTC + allocGOLD + allocUSDC;

  if (hardAllocTotal === 0) return swaps;

  const toBTC = (amount * BigInt(allocBTC)) / BigInt(hardAllocTotal);
  const toGOLD = (amount * BigInt(allocGOLD)) / BigInt(hardAllocTotal);
  // Rest stays as USDC buffer (not swapped)

  if (toBTC > 0n) swaps.push({ assetKey: 'BTC', usdcAmount: toBTC });
  if (toGOLD > 0n) swaps.push({ assetKey: 'GOLD', usdcAmount: toGOLD });

  return swaps;
}

/**
 * Execute a diversification swap through the treasury contract
 */
export async function executeDiversificationSwap(
  fromAssetKey: string,
  toAssetKey: string,
  amountIn: bigint,
  minAmountOut: bigint,
  lifiData: string,
  gasLimit: bigint
): Promise<string> {
  if (!config.contracts.treasury) {
    throw new Error('TREASURY_ADDRESS not configured');
  }

  const provider = getWsProvider();
  const wallet = new ethers.Wallet(config.signer.privateKey, provider);

  const treasuryAbi = [
    'function executeSwap(bytes32 fromAsset, bytes32 toAsset, uint256 amountIn, uint256 minAmountOut, bytes calldata lifiData) external',
  ];

  const treasury = new ethers.Contract(
    config.contracts.treasury,
    treasuryAbi,
    wallet
  );

  // Convert string keys to bytes32
  const fromAssetBytes32 = ethers.encodeBytes32String(fromAssetKey);
  const toAssetBytes32 = ethers.encodeBytes32String(toAssetKey);

  // Add 20% buffer to LiFi's gasLimit for the outer Treasury call
  // This accounts for Treasury's overhead: balance checks, event emission, slippage check
  const gasLimitWithBuffer = (gasLimit * 120n) / 100n;

  console.log(
    `[LiFi] Executing swap: ${fromAssetKey} -> ${toAssetKey}, amount: ${amountIn.toString()}, gasLimit: ${gasLimitWithBuffer.toString()}`
  );

  const tx = await treasury.executeSwap(
    fromAssetBytes32,
    toAssetBytes32,
    amountIn,
    minAmountOut,
    lifiData,
    { gasLimit: gasLimitWithBuffer }
  );

  const receipt = await tx.wait();
  console.log(`[LiFi] Swap executed, tx: ${receipt.hash}`);

  return receipt.hash;
}

/**
 * Get token addresses for a given asset key
 * This should be fetched from the treasury contract in production
 */
export async function getAssetTokenAddress(assetKey: string): Promise<string> {
  if (!config.contracts.treasury) {
    throw new Error('TREASURY_ADDRESS not configured');
  }

  const provider = getWsProvider();
  const treasuryAbi = ['function assets(bytes32 key) external view returns (address token, address priceFeed, uint8 decimals, uint256 targetBps, bool active)'];

  const treasury = new ethers.Contract(
    config.contracts.treasury,
    treasuryAbi,
    provider
  );

  const assetBytes32 = ethers.encodeBytes32String(assetKey);
  const asset = await treasury.assets(assetBytes32);

  return asset.token;
}

/**
 * Get all active assets and their target allocations from the treasury
 */
export async function getTargetAllocations(): Promise<Map<string, number>> {
  if (!config.contracts.treasury) {
    throw new Error('TREASURY_ADDRESS not configured');
  }

  const provider = getWsProvider();
  const treasuryAbi = [
    'function getAllAssets() external view returns (bytes32[] memory keys, tuple(address token, address priceFeed, uint8 decimals, uint256 targetBps, bool active)[] memory assetList)',
  ];

  const treasury = new ethers.Contract(
    config.contracts.treasury,
    treasuryAbi,
    provider
  );

  const [keys, assets] = await treasury.getAllAssets();
  const allocations = new Map<string, number>();

  for (let i = 0; i < keys.length; i++) {
    const key = ethers.decodeBytes32String(keys[i]);
    if (assets[i].active) {
      allocations.set(key, Number(assets[i].targetBps));
    }
  }

  return allocations;
}
