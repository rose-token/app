import { ethers } from 'ethers';
import { config } from '../config';

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

// Asset keys as bytes32
const BTC_KEY = ethers.encodeBytes32String('BTC');
const GOLD_KEY = ethers.encodeBytes32String('GOLD');
const STABLE_KEY = ethers.encodeBytes32String('STABLE');
const ROSE_KEY = ethers.encodeBytes32String('ROSE');

// Treasury ABI for price lookups
const PRICE_LOOKUP_ABI = [
  'function getAssetPrice(bytes32 key) external view returns (uint256)',
  'function assets(bytes32 key) external view returns (address token, address priceFeed, uint8 decimals, uint256 targetBps, bool active)',
];

// Token decimals for mock calculations
const ASSET_DECIMALS: Record<string, number> = {
  'BTC': 8,    // TBTC uses 8 decimals
  'GOLD': 6,   // XAUt uses 6 decimals
  'STABLE': 6, // USDC uses 6 decimals
  'ROSE': 18,  // ROSE uses 18 decimals
};

/**
 * Map token address to asset key by looking up treasury assets
 */
async function getAssetKeyForToken(tokenAddress: string, treasuryAddress: string): Promise<string | null> {
  const provider = new ethers.JsonRpcProvider(config.rpc.url);
  const treasury = new ethers.Contract(treasuryAddress, PRICE_LOOKUP_ABI, provider);

  // Check each asset key (including ROSE for rebalancing)
  for (const key of ['BTC', 'GOLD', 'STABLE', 'ROSE']) {
    try {
      const keyBytes = ethers.encodeBytes32String(key);
      const asset = await treasury.assets(keyBytes);
      if (asset.token.toLowerCase() === tokenAddress.toLowerCase()) {
        return key;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Calculate realistic swap output using mock Chainlink prices
 * Prices are in 8 decimals (Chainlink standard)
 */
async function calculateMockSwapOutput(
  fromToken: string,
  toToken: string,
  amountIn: bigint,
  treasuryAddress: string
): Promise<bigint> {
  const provider = new ethers.JsonRpcProvider(config.rpc.url);
  const treasury = new ethers.Contract(treasuryAddress, PRICE_LOOKUP_ABI, provider);

  // Identify asset keys
  const fromKey = await getAssetKeyForToken(fromToken, treasuryAddress);
  const toKey = await getAssetKeyForToken(toToken, treasuryAddress);

  if (!fromKey || !toKey) {
    console.warn(`[LiFi] Could not identify asset keys for ${fromToken} -> ${toToken}, using 1:1`);
    return amountIn;
  }

  // Get prices (STABLE = $1 = 1e8 in Chainlink decimals)
  const fromPrice = fromKey === 'STABLE' ? BigInt(1e8) : await treasury.getAssetPrice(ethers.encodeBytes32String(fromKey));
  const toPrice = toKey === 'STABLE' ? BigInt(1e8) : await treasury.getAssetPrice(ethers.encodeBytes32String(toKey));

  const fromDecimals = ASSET_DECIMALS[fromKey] || 18;
  const toDecimals = ASSET_DECIMALS[toKey] || 18;

  // Calculate: valueUSD = amountIn * fromPrice / 10^(fromDecimals + 8)
  // outputAmount = valueUSD * 10^(toDecimals + 8) / toPrice
  // Simplified: outputAmount = amountIn * fromPrice * 10^toDecimals / (10^fromDecimals * toPrice)

  const output = (amountIn * fromPrice * BigInt(10 ** toDecimals)) / (BigInt(10 ** fromDecimals) * toPrice);

  console.log(`[LiFi] Mock price calc: ${fromKey}(${fromPrice.toString()}) -> ${toKey}(${toPrice.toString()})`);
  console.log(`[LiFi] Input: ${amountIn.toString()} (${fromDecimals} dec) -> Output: ${output.toString()} (${toDecimals} dec)`);

  return output;
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

  console.log(
    `[LiFi] Quote: ${ethers.formatUnits(amountIn, quote.action.fromToken.decimals)} ${quote.action.fromToken.symbol} -> ` +
      `${ethers.formatUnits(estimatedAmountOut, quote.action.toToken.decimals)} ${quote.action.toToken.symbol}`
  );

  return {
    lifiData: quote.transactionRequest.data,
    minAmountOut,
    estimatedAmountOut,
    gasCost,
  };
}

/**
 * Calculate the min amount out with slippage applied
 */
export function applySlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10000 - slippageBps)) / 10000n;
}

/**
 * Calculate diversification swaps based on deposit amount and target allocations
 * @param depositAmountUsdc - USDC deposited (6 decimals)
 * @param targetAllocations - Map of asset key to target bps (e.g., { BTC: 3000, GOLD: 3000 })
 * @returns Array of swap instructions
 */
export function calculateDiversificationSwaps(
  depositAmountUsdc: bigint,
  targetAllocations: Map<string, number>
): { assetKey: string; usdcAmount: bigint }[] {
  const swaps: { assetKey: string; usdcAmount: bigint }[] = [];

  // Calculate total allocation for hard assets that need swaps (exclude USDC and ROSE)
  let totalSwapBps = 0;
  for (const [key, bps] of targetAllocations) {
    if (key !== 'STABLE' && key !== 'ROSE') {
      totalSwapBps += bps;
    }
  }

  // If no swaps needed, return empty
  if (totalSwapBps === 0) return swaps;

  // Calculate amount for each asset
  for (const [key, bps] of targetAllocations) {
    if (key !== 'STABLE' && key !== 'ROSE') {
      // Rescale: if BTC is 30% and total swap is 60%, BTC gets 50% of deposit
      const rescaledBps = (bps * 10000) / totalSwapBps;
      const usdcAmount = (depositAmountUsdc * BigInt(rescaledBps)) / 10000n;

      if (usdcAmount > 0n) {
        swaps.push({ assetKey: key, usdcAmount });
      }
    }
  }

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
  lifiData: string
): Promise<string> {
  if (!config.contracts.treasury) {
    throw new Error('TREASURY_ADDRESS not configured');
  }

  const provider = new ethers.JsonRpcProvider(config.rpc.url);
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

  console.log(
    `[LiFi] Executing swap: ${fromAssetKey} -> ${toAssetKey}, amount: ${amountIn.toString()}`
  );

  const tx = await treasury.executeSwap(
    fromAssetBytes32,
    toAssetBytes32,
    amountIn,
    minAmountOut,
    lifiData
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

  const provider = new ethers.JsonRpcProvider(config.rpc.url);
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

  const provider = new ethers.JsonRpcProvider(config.rpc.url);
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
