/**
 * Camelot LP Fee Collection Service
 *
 * Collects accumulated trading fees from Camelot LP positions
 * and sends them directly to the Treasury contract.
 *
 * Architecture:
 * - Deployer wallet holds LP position NFT
 * - Backend signer uses same private key as deployer
 * - collect() called with recipient = treasury address
 * - Fees go directly to treasury, increasing NAV
 */

import { ethers } from 'ethers';
import { config } from '../config';
import { getWsProvider } from '../utils/wsProvider';

// Minimal ABI for Camelot/Algebra NonfungiblePositionManager
const POSITION_MANAGER_ABI = [
  'function collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) external payable returns (uint256 amount0, uint256 amount1)',
  'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
];

// ERC20 minimal ABI for token info
const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

// Types
export interface PositionInfo {
  tokenId: string;
  owner: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  liquidity: string;
  pendingFees0: string;
  pendingFees1: string;
}

export interface CollectResult {
  tokenId: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  amount0Formatted: string;
  amount1Formatted: string;
  txHash: string;
  recipient: string;
}

export interface CollectAllResult {
  success: boolean;
  collected: CollectResult[];
  skipped: string[]; // positions with no fees
  errors: { tokenId: string; error: string }[];
  timestamp: string;
}

/**
 * Get position manager contract instance
 */
function getPositionManager(signer?: ethers.Signer): ethers.Contract {
  return new ethers.Contract(
    config.camelotLP.positionManager,
    POSITION_MANAGER_ABI,
    signer || getWsProvider()
  );
}

/**
 * Get wallet signer for transactions
 */
function getSigner(): ethers.Wallet {
  return new ethers.Wallet(config.signer.privateKey, getWsProvider());
}

/**
 * Get token metadata (symbol and decimals)
 */
async function getTokenInfo(
  tokenAddress: string
): Promise<{ symbol: string; decimals: number }> {
  try {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, getWsProvider());
    const [symbol, decimals] = await Promise.all([
      token.symbol(),
      token.decimals(),
    ]);
    return { symbol, decimals: Number(decimals) };
  } catch {
    return { symbol: 'UNKNOWN', decimals: 18 };
  }
}

/**
 * Get detailed info for a position including pending fees
 */
export async function getPositionInfo(tokenId: string): Promise<PositionInfo> {
  const pm = getPositionManager();

  const [owner, position] = await Promise.all([
    pm.ownerOf(tokenId),
    pm.positions(tokenId),
  ]);

  const [token0Info, token1Info] = await Promise.all([
    getTokenInfo(position.token0),
    getTokenInfo(position.token1),
  ]);

  return {
    tokenId,
    owner,
    token0: position.token0,
    token1: position.token1,
    token0Symbol: token0Info.symbol,
    token1Symbol: token1Info.symbol,
    token0Decimals: token0Info.decimals,
    token1Decimals: token1Info.decimals,
    liquidity: position.liquidity.toString(),
    pendingFees0: position.tokensOwed0.toString(),
    pendingFees1: position.tokensOwed1.toString(),
  };
}

/**
 * Get info for all configured positions
 */
export async function getAllPositions(): Promise<PositionInfo[]> {
  const results: PositionInfo[] = [];

  for (const tokenId of config.camelotLP.positionIds) {
    try {
      const info = await getPositionInfo(tokenId);
      results.push(info);
    } catch (error) {
      console.error(`[CamelotLP] Failed to fetch position ${tokenId}:`, error);
    }
  }

  return results;
}

/**
 * Collect fees from a single position and send to treasury
 */
export async function collectFees(tokenId: string): Promise<CollectResult> {
  const signer = getSigner();
  const signerAddress = await signer.getAddress();
  const pm = getPositionManager(signer);

  // Get position info
  const info = await getPositionInfo(tokenId);

  // Verify signer owns this position
  if (info.owner.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error(
      `Position ${tokenId} owned by ${info.owner}, signer is ${signerAddress}`
    );
  }

  // Check if there are fees to collect
  const hasFees = BigInt(info.pendingFees0) > 0n || BigInt(info.pendingFees1) > 0n;
  if (!hasFees) {
    console.log(`[CamelotLP] Position ${tokenId}: No pending fees`);
    return {
      tokenId,
      token0: info.token0,
      token1: info.token1,
      token0Symbol: info.token0Symbol,
      token1Symbol: info.token1Symbol,
      amount0: '0',
      amount1: '0',
      amount0Formatted: '0',
      amount1Formatted: '0',
      txHash: '',
      recipient: config.contracts.treasury || '',
    };
  }

  console.log(
    `[CamelotLP] Position ${tokenId}: Collecting ${info.pendingFees0} ${info.token0Symbol}, ${info.pendingFees1} ${info.token1Symbol}`
  );

  // Recipient = treasury address
  const recipient = config.contracts.treasury;
  if (!recipient) {
    throw new Error('TREASURY_ADDRESS not configured');
  }

  // Call collect with max amounts - fees go directly to treasury
  // uint128 max = 340282366920938463463374607431768211455
  const tx = await pm.collect({
    tokenId: BigInt(tokenId),
    recipient,
    amount0Max: BigInt('340282366920938463463374607431768211455'),
    amount1Max: BigInt('340282366920938463463374607431768211455'),
  });

  console.log(`[CamelotLP] TX submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`[CamelotLP] TX confirmed: ${receipt.hash}`);

  // Format amounts for logging
  const amount0Formatted = ethers.formatUnits(info.pendingFees0, info.token0Decimals);
  const amount1Formatted = ethers.formatUnits(info.pendingFees1, info.token1Decimals);

  return {
    tokenId,
    token0: info.token0,
    token1: info.token1,
    token0Symbol: info.token0Symbol,
    token1Symbol: info.token1Symbol,
    amount0: info.pendingFees0,
    amount1: info.pendingFees1,
    amount0Formatted,
    amount1Formatted,
    txHash: receipt.hash,
    recipient,
  };
}

/**
 * Collect fees from all configured positions
 */
export async function collectAllFees(): Promise<CollectAllResult> {
  const positionIds = config.camelotLP.positionIds;

  if (positionIds.length === 0) {
    console.log('[CamelotLP] No positions configured');
    return {
      success: true,
      collected: [],
      skipped: [],
      errors: [],
      timestamp: new Date().toISOString(),
    };
  }

  console.log(`[CamelotLP] Collecting fees from ${positionIds.length} positions...`);

  const collected: CollectResult[] = [];
  const skipped: string[] = [];
  const errors: { tokenId: string; error: string }[] = [];

  for (const tokenId of positionIds) {
    try {
      const result = await collectFees(tokenId);

      if (result.txHash) {
        collected.push(result);
        console.log(
          `[CamelotLP] Position ${tokenId}: ${result.amount0Formatted} ${result.token0Symbol}, ${result.amount1Formatted} ${result.token1Symbol}`
        );
      } else {
        skipped.push(tokenId);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[CamelotLP] Position ${tokenId}: ${msg}`);
      errors.push({ tokenId, error: msg });
    }
  }

  console.log(
    `[CamelotLP] Complete: ${collected.length} collected, ${skipped.length} skipped, ${errors.length} errors`
  );

  return {
    success: errors.length === 0,
    collected,
    skipped,
    errors,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check if Camelot LP fee collection is properly configured
 */
export function isCamelotLPConfigured(): boolean {
  return (
    config.camelotLP.enabled &&
    config.camelotLP.positionIds.length > 0 &&
    !!config.contracts.treasury &&
    !!config.signer.privateKey
  );
}
