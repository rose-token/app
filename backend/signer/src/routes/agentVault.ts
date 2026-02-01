/**
 * Agent Vault Routes
 *
 * REST API endpoints for agents to interact with the Treasury vault.
 * Agents can deposit USDC → ROSE and redeem ROSE → USDC.
 * All endpoints require API key authentication (bypasses Gitcoin Passport).
 *
 * The Treasury is the real vault:
 * - Deposit: User sends USDC, Treasury mints ROSE at current NAV
 * - Redeem: User sends ROSE, Treasury burns ROSE and returns USDC at current NAV
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { agentAuth } from '../middleware/agentAuth';
import { signApproval } from '../services/signer';
import { config } from '../config';
import { getTreasuryContract, getHttpProvider } from '../utils/contracts';

const router = Router();

// All vault endpoints require agent authentication
router.use(agentAuth);

// ============================================================
// Minimal ABIs for calldata encoding and balance reads
// ============================================================

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const TREASURY_DEPOSIT_ABI = [
  'function deposit(uint256 usdcAmount, uint256 expiry, bytes signature)',
];

const TREASURY_REDEEM_ABI = [
  'function redeem(uint256 roseAmount, uint256 expiry, bytes signature)',
];

// ============================================================
// Token address cache (immutable on contract)
// ============================================================

let roseTokenAddress: string | null = null;
let usdcAddress: string | null = null;

/**
 * Resolve and cache ROSE token and USDC addresses from the Treasury contract.
 * These are immutable, so we only need to read them once.
 */
async function getTokenAddresses(): Promise<{ roseToken: string; usdc: string }> {
  if (roseTokenAddress && usdcAddress) {
    return { roseToken: roseTokenAddress, usdc: usdcAddress };
  }

  const treasury = getTreasuryContract(getHttpProvider());
  const [rose, usdc] = await Promise.all([
    treasury.roseToken(),
    treasury.usdc(),
  ]);

  roseTokenAddress = rose as string;
  usdcAddress = usdc as string;

  return { roseToken: roseTokenAddress, usdc: usdcAddress };
}

// ============================================================
// Helpers
// ============================================================

/**
 * Parse and validate a USDC amount string (human-readable, 6 decimals).
 * Returns the amount in smallest units or null if invalid.
 */
function parseUsdcAmount(amount: string): bigint | null {
  try {
    const units = ethers.parseUnits(amount, 6);
    if (units <= 0n) return null;
    return units;
  } catch {
    return null;
  }
}

/**
 * Parse and validate a ROSE amount string (human-readable, 18 decimals).
 * Returns the amount in wei or null if invalid.
 */
function parseRoseAmount(amount: string): bigint | null {
  try {
    const wei = ethers.parseUnits(amount, 18);
    if (wei <= 0n) return null;
    return wei;
  } catch {
    return null;
  }
}

// Upper-bound limits to reject absurdly large amounts
// 1 billion USDC (6 decimals) = 1e15 smallest units
const MAX_USDC_AMOUNT = ethers.parseUnits('1000000000', 6);
// 1 billion ROSE (18 decimals) = 1e27 smallest units
const MAX_ROSE_AMOUNT = ethers.parseUnits('1000000000', 18);

// ============================================================
// Routes
// ============================================================

/**
 * POST /api/agent/vault/deposit
 * Generate parameters for depositing USDC → ROSE via Treasury.
 *
 * The agent executes two on-chain transactions:
 *   1. approve(treasury, usdcAmount) on the USDC token
 *   2. deposit(usdcAmount, expiry, signature) on the Treasury contract
 *
 * Body:
 * - amount: USDC amount as string (e.g. "100" for 100 USDC)
 */
router.post('/vault/deposit', async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;

    if (!amount || typeof amount !== 'string') {
      return res.status(400).json({ error: 'amount is required (string, e.g. "100" for 100 USDC)' });
    }

    const usdcAmountWei = parseUsdcAmount(amount);
    if (!usdcAmountWei) {
      return res.status(400).json({ error: 'Invalid amount — must be a positive number' });
    }
    if (usdcAmountWei > MAX_USDC_AMOUNT) {
      return res.status(400).json({ error: 'Amount exceeds maximum allowed (1 billion USDC)' });
    }

    const agentAddress = req.agent!.walletAddress;
    const treasuryAddress = config.contracts.treasury;

    if (!treasuryAddress) {
      return res.status(500).json({ error: 'Treasury contract not configured' });
    }

    const { usdc: usdcAddr, roseToken } = await getTokenAddresses();

    // Get preview: how much ROSE will be minted
    const provider = getHttpProvider();
    const treasury = getTreasuryContract(provider);
    const roseToReceive = await treasury.calculateRoseForDeposit(usdcAmountWei) as bigint;

    // Sign approval (bypasses Gitcoin Passport — agent is authenticated via API key)
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
    const signature = await signApproval(agentAddress, 'deposit', expiry);

    // Encode calldata for both transactions
    const erc20Iface = new ethers.Interface(ERC20_ABI);
    const treasuryIface = new ethers.Interface(TREASURY_DEPOSIT_ABI);

    const approveCalldata = erc20Iface.encodeFunctionData('approve', [
      treasuryAddress,
      usdcAmountWei,
    ]);
    const depositCalldata = treasuryIface.encodeFunctionData('deposit', [
      usdcAmountWei,
      expiry,
      signature,
    ]);

    console.log(
      `[AgentVault] Deposit params generated for ${agentAddress}: ${amount} USDC → ~${ethers.formatUnits(roseToReceive, 18)} ROSE`
    );

    return res.json({
      success: true,
      agent: agentAddress,
      amount,
      amountWei: usdcAmountWei.toString(),
      decimals: 6,
      token: 'USDC',
      preview: {
        roseToReceive: roseToReceive.toString(),
        roseToReceiveFormatted: ethers.formatUnits(roseToReceive, 18),
      },
      approval: {
        expiry,
        signature,
      },
      transactions: [
        {
          step: 1,
          description: 'Approve USDC spending by Treasury contract',
          to: usdcAddr,
          calldata: approveCalldata,
          function: 'approve(address,uint256)',
          args: [treasuryAddress, usdcAmountWei.toString()],
        },
        {
          step: 2,
          description: 'Deposit USDC to Treasury, receive ROSE at current NAV',
          to: treasuryAddress,
          calldata: depositCalldata,
          function: 'deposit(uint256,uint256,bytes)',
          args: [usdcAmountWei.toString(), expiry.toString(), signature],
        },
      ],
      castCommands: {
        approve: `cast send ${usdcAddr} "approve(address,uint256)" ${treasuryAddress} ${usdcAmountWei} --rpc-url ${config.rpc.url}`,
        deposit: `cast send ${treasuryAddress} "deposit(uint256,uint256,bytes)" ${usdcAmountWei} ${expiry} ${signature} --rpc-url ${config.rpc.url}`,
      },
    });
  } catch (error) {
    console.error('[AgentVault] Deposit error:', error);
    return res.status(500).json({ error: 'Failed to generate deposit parameters' });
  }
});

/**
 * POST /api/agent/vault/redeem
 * Generate parameters for redeeming ROSE → USDC via Treasury.
 *
 * The agent executes one on-chain transaction:
 *   1. redeem(roseAmount, expiry, signature) on the Treasury contract
 *
 * Note: No approval needed — the Treasury burns ROSE directly from the sender
 * via IRoseToken.burn(msg.sender, amount).
 *
 * Body:
 * - amount: ROSE amount as string (e.g. "100" for 100 ROSE)
 */
router.post('/vault/redeem', async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;

    if (!amount || typeof amount !== 'string') {
      return res.status(400).json({ error: 'amount is required (string, e.g. "100" for 100 ROSE)' });
    }

    const roseAmountWei = parseRoseAmount(amount);
    if (!roseAmountWei) {
      return res.status(400).json({ error: 'Invalid amount — must be a positive number' });
    }
    if (roseAmountWei > MAX_ROSE_AMOUNT) {
      return res.status(400).json({ error: 'Amount exceeds maximum allowed (1 billion ROSE)' });
    }

    const agentAddress = req.agent!.walletAddress;
    const treasuryAddress = config.contracts.treasury;

    if (!treasuryAddress) {
      return res.status(500).json({ error: 'Treasury contract not configured' });
    }

    // Get preview: how much USDC the agent will receive
    const provider = getHttpProvider();
    const treasury = getTreasuryContract(provider);
    const usdcToReceive = await treasury.calculateUsdcForRedemption(roseAmountWei) as bigint;

    // Sign approval (bypasses Gitcoin Passport — agent is authenticated via API key)
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
    const signature = await signApproval(agentAddress, 'redeem', expiry);

    // Encode calldata
    const treasuryIface = new ethers.Interface(TREASURY_REDEEM_ABI);
    const redeemCalldata = treasuryIface.encodeFunctionData('redeem', [
      roseAmountWei,
      expiry,
      signature,
    ]);

    console.log(
      `[AgentVault] Redeem params generated for ${agentAddress}: ${amount} ROSE → ~${ethers.formatUnits(usdcToReceive, 6)} USDC`
    );

    return res.json({
      success: true,
      agent: agentAddress,
      amount,
      amountWei: roseAmountWei.toString(),
      decimals: 18,
      token: 'ROSE',
      preview: {
        usdcToReceive: usdcToReceive.toString(),
        usdcToReceiveFormatted: ethers.formatUnits(usdcToReceive, 6),
      },
      approval: {
        expiry,
        signature,
      },
      transactions: [
        {
          step: 1,
          description: 'Redeem ROSE for USDC at current NAV (Treasury burns ROSE, sends USDC)',
          to: treasuryAddress,
          calldata: redeemCalldata,
          function: 'redeem(uint256,uint256,bytes)',
          args: [roseAmountWei.toString(), expiry.toString(), signature],
        },
      ],
      castCommands: {
        redeem: `cast send ${treasuryAddress} "redeem(uint256,uint256,bytes)" ${roseAmountWei} ${expiry} ${signature} --rpc-url ${config.rpc.url}`,
      },
    });
  } catch (error) {
    console.error('[AgentVault] Redeem error:', error);
    return res.status(500).json({ error: 'Failed to generate redeem parameters' });
  }
});

/**
 * GET /api/agent/vault/balance
 * Read the agent's USDC balance, ROSE balance, and current ROSE price/NAV.
 */
router.get('/vault/balance', async (req: Request, res: Response) => {
  try {
    const agentAddress = req.agent!.walletAddress;
    const treasuryAddress = config.contracts.treasury;

    if (!treasuryAddress) {
      return res.status(500).json({ error: 'Treasury contract not configured' });
    }

    const provider = getHttpProvider();
    const { roseToken, usdc: usdcAddr } = await getTokenAddresses();

    // Create contract instances for balance reads
    const roseContract = new ethers.Contract(roseToken, ERC20_ABI, provider);
    const usdcContract = new ethers.Contract(usdcAddr, ERC20_ABI, provider);
    const treasury = getTreasuryContract(provider);

    // Read all balances and NAV in parallel
    const [roseBalance, usdcBalance, rosePrice] = await Promise.all([
      roseContract.balanceOf(agentAddress) as Promise<bigint>,
      usdcContract.balanceOf(agentAddress) as Promise<bigint>,
      treasury.rosePrice() as Promise<bigint>,
    ]);

    return res.json({
      agent: agentAddress,
      roseToken,
      usdcToken: usdcAddr,
      treasuryContract: treasuryAddress,
      balances: {
        usdc: usdcBalance.toString(),
        usdcFormatted: ethers.formatUnits(usdcBalance, 6),
        rose: roseBalance.toString(),
        roseFormatted: ethers.formatUnits(roseBalance, 18),
      },
      nav: {
        rosePrice: rosePrice.toString(),
        rosePriceFormatted: ethers.formatUnits(rosePrice, 6),
      },
    });
  } catch (error) {
    console.error('[AgentVault] Balance error:', error);
    return res.status(500).json({ error: 'Failed to read vault balances' });
  }
});

/**
 * GET /api/agent/vault/price
 * Return current ROSE price, NAV per share, and treasury TVL.
 */
router.get('/vault/price', async (req: Request, res: Response) => {
  try {
    const treasuryAddress = config.contracts.treasury;

    if (!treasuryAddress) {
      return res.status(500).json({ error: 'Treasury contract not configured' });
    }

    const provider = getHttpProvider();
    const treasury = getTreasuryContract(provider);

    // Read price, TVL, and circulating supply in parallel
    const [rosePrice, hardAssetValue, circulatingSupply, vaultBreakdown] = await Promise.all([
      treasury.rosePrice() as Promise<bigint>,
      treasury.hardAssetValueUSD() as Promise<bigint>,
      treasury.circulatingSupply() as Promise<bigint>,
      treasury.getVaultBreakdown() as Promise<[bigint, bigint, bigint, boolean]>,
    ]);

    const [totalHardAssets, currentRosePrice, circulatingRose, rebalanceNeeded] = vaultBreakdown;

    return res.json({
      treasuryContract: treasuryAddress,
      price: {
        rosePrice: rosePrice.toString(),
        rosePriceFormatted: ethers.formatUnits(rosePrice, 6),
        rosePriceUsd: `$${Number(ethers.formatUnits(rosePrice, 6)).toFixed(4)}`,
      },
      treasury: {
        tvl: hardAssetValue.toString(),
        tvlFormatted: ethers.formatUnits(hardAssetValue, 6),
        tvlUsd: `$${Number(ethers.formatUnits(hardAssetValue, 6)).toFixed(2)}`,
        circulatingSupply: circulatingSupply.toString(),
        circulatingSupplyFormatted: ethers.formatUnits(circulatingSupply, 18),
        rebalanceNeeded,
      },
    });
  } catch (error) {
    console.error('[AgentVault] Price error:', error);
    return res.status(500).json({ error: 'Failed to read vault price data' });
  }
});

export default router;
