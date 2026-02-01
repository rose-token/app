/**
 * Agent Vault Routes
 *
 * REST API endpoints for agents to interact with the governance vault.
 * Agents can deposit ROSE → vROSE and withdraw vROSE → ROSE.
 * All endpoints require API key authentication (bypasses Gitcoin Passport).
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { agentAuth } from '../middleware/agentAuth';
import { signApproval } from '../services/signer';
import { config } from '../config';
import { getGovernanceContract, getHttpProvider } from '../utils/contracts';

const router = Router();

// All vault endpoints require agent authentication
router.use(agentAuth);

// ============================================================
// Minimal ABIs for calldata encoding and balance reads
// ============================================================

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

const GOVERNANCE_DEPOSIT_ABI = [
  'function deposit(uint256 amount)',
];

const GOVERNANCE_WITHDRAW_ABI = [
  'function withdraw(uint256 amount)',
];

// ============================================================
// Token address cache (immutable on contract)
// ============================================================

let roseTokenAddress: string | null = null;
let vRoseTokenAddress: string | null = null;

/**
 * Resolve and cache ROSE / vROSE token addresses from the governance contract.
 * These are immutable, so we only need to read them once.
 */
async function getTokenAddresses(): Promise<{ roseToken: string; vRose: string }> {
  if (roseTokenAddress && vRoseTokenAddress) {
    return { roseToken: roseTokenAddress, vRose: vRoseTokenAddress };
  }

  const governance = getGovernanceContract(getHttpProvider());
  const [rose, vRose] = await Promise.all([
    governance.roseToken(),
    governance.vRoseToken(),
  ]);

  roseTokenAddress = rose as string;
  vRoseTokenAddress = vRose as string;

  return { roseToken: roseTokenAddress, vRose: vRoseTokenAddress };
}

// ============================================================
// Helpers
// ============================================================

/**
 * Parse and validate a token amount string (human-readable, 18 decimals).
 * Returns the amount in wei or null if invalid.
 */
function parseAmount(amount: string): bigint | null {
  try {
    const wei = ethers.parseUnits(amount, 18);
    if (wei <= 0n) return null;
    return wei;
  } catch {
    return null;
  }
}

// ============================================================
// Routes
// ============================================================

/**
 * POST /api/agent/vault/deposit
 * Generate parameters for depositing ROSE → vROSE.
 *
 * The agent executes two on-chain transactions:
 *   1. approve(governance, amount) on the ROSE token
 *   2. deposit(amount) on the governance contract
 *
 * Body:
 * - amount: ROSE token amount as string (e.g. "100" for 100 ROSE)
 */
router.post('/vault/deposit', async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;

    if (!amount || typeof amount !== 'string') {
      return res.status(400).json({ error: 'amount is required (string, e.g. "100")' });
    }

    const amountWei = parseAmount(amount);
    if (!amountWei) {
      return res.status(400).json({ error: 'Invalid amount — must be a positive number' });
    }

    const agentAddress = req.agent!.walletAddress;
    const governanceAddress = config.contracts.governance;

    if (!governanceAddress) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const { roseToken } = await getTokenAddresses();

    // Sign approval (bypasses Gitcoin Passport — agent is authenticated via API key)
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
    const signature = await signApproval(agentAddress, 'deposit', expiry);

    // Encode calldata for both transactions
    const erc20Iface = new ethers.Interface(ERC20_ABI);
    const govIface = new ethers.Interface(GOVERNANCE_DEPOSIT_ABI);

    const approveCalldata = erc20Iface.encodeFunctionData('approve', [
      governanceAddress,
      amountWei,
    ]);
    const depositCalldata = govIface.encodeFunctionData('deposit', [amountWei]);

    console.log(
      `[AgentVault] Deposit params generated for ${agentAddress}: ${amount} ROSE`
    );

    return res.json({
      success: true,
      agent: agentAddress,
      amount,
      amountWei: amountWei.toString(),
      approval: {
        expiry,
        signature,
      },
      transactions: [
        {
          step: 1,
          description: 'Approve ROSE token spending by governance contract',
          to: roseToken,
          calldata: approveCalldata,
          function: 'approve(address,uint256)',
          args: [governanceAddress, amountWei.toString()],
        },
        {
          step: 2,
          description: 'Deposit ROSE to governance vault, receive vROSE 1:1',
          to: governanceAddress,
          calldata: depositCalldata,
          function: 'deposit(uint256)',
          args: [amountWei.toString()],
        },
      ],
      castCommands: {
        approve: `cast send ${roseToken} "approve(address,uint256)" ${governanceAddress} ${amountWei} --rpc-url ${config.rpc.url}`,
        deposit: `cast send ${governanceAddress} "deposit(uint256)" ${amountWei} --rpc-url ${config.rpc.url}`,
      },
    });
  } catch (error) {
    console.error('[AgentVault] Deposit error:', error);
    return res.status(500).json({ error: 'Failed to generate deposit parameters' });
  }
});

/**
 * POST /api/agent/vault/withdraw
 * Generate parameters for withdrawing vROSE → ROSE.
 *
 * The agent executes one on-chain transaction:
 *   1. withdraw(amount) on the governance contract
 *
 * Body:
 * - amount: vROSE amount to withdraw as string (e.g. "100" for 100 vROSE)
 */
router.post('/vault/withdraw', async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;

    if (!amount || typeof amount !== 'string') {
      return res.status(400).json({ error: 'amount is required (string, e.g. "100")' });
    }

    const amountWei = parseAmount(amount);
    if (!amountWei) {
      return res.status(400).json({ error: 'Invalid amount — must be a positive number' });
    }

    const agentAddress = req.agent!.walletAddress;
    const governanceAddress = config.contracts.governance;

    if (!governanceAddress) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    // Sign approval (bypasses Gitcoin Passport — agent is authenticated via API key)
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
    const signature = await signApproval(agentAddress, 'redeem', expiry);

    // Encode calldata
    const govIface = new ethers.Interface(GOVERNANCE_WITHDRAW_ABI);
    const withdrawCalldata = govIface.encodeFunctionData('withdraw', [amountWei]);

    console.log(
      `[AgentVault] Withdraw params generated for ${agentAddress}: ${amount} vROSE`
    );

    return res.json({
      success: true,
      agent: agentAddress,
      amount,
      amountWei: amountWei.toString(),
      approval: {
        expiry,
        signature,
      },
      transactions: [
        {
          step: 1,
          description: 'Withdraw ROSE from governance vault, burn vROSE',
          to: governanceAddress,
          calldata: withdrawCalldata,
          function: 'withdraw(uint256)',
          args: [amountWei.toString()],
        },
      ],
      castCommands: {
        withdraw: `cast send ${governanceAddress} "withdraw(uint256)" ${amountWei} --rpc-url ${config.rpc.url}`,
      },
    });
  } catch (error) {
    console.error('[AgentVault] Withdraw error:', error);
    return res.status(500).json({ error: 'Failed to generate withdraw parameters' });
  }
});

/**
 * GET /api/agent/vault/balance
 * Read the agent's ROSE balance, vROSE balance, and staked amount from on-chain.
 */
router.get('/vault/balance', async (req: Request, res: Response) => {
  try {
    const agentAddress = req.agent!.walletAddress;
    const governanceAddress = config.contracts.governance;

    if (!governanceAddress) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const provider = getHttpProvider();
    const { roseToken, vRose } = await getTokenAddresses();

    // Create contract instances for balance reads
    const roseContract = new ethers.Contract(roseToken, ERC20_ABI, provider);
    const vRoseContract = new ethers.Contract(vRose, ERC20_ABI, provider);
    const governance = getGovernanceContract(provider);

    // Read all balances in parallel
    const [roseBalance, vRoseBalance, stakedRose] = await Promise.all([
      roseContract.balanceOf(agentAddress) as Promise<bigint>,
      vRoseContract.balanceOf(agentAddress) as Promise<bigint>,
      governance.stakedRose(agentAddress) as Promise<bigint>,
    ]);

    return res.json({
      agent: agentAddress,
      roseToken: roseToken,
      vRoseToken: vRose,
      governanceContract: governanceAddress,
      balances: {
        rose: roseBalance.toString(),
        roseFormatted: ethers.formatUnits(roseBalance, 18),
        vRose: vRoseBalance.toString(),
        vRoseFormatted: ethers.formatUnits(vRoseBalance, 18),
        staked: stakedRose.toString(),
        stakedFormatted: ethers.formatUnits(stakedRose, 18),
      },
    });
  } catch (error) {
    console.error('[AgentVault] Balance error:', error);
    return res.status(500).json({ error: 'Failed to read vault balances' });
  }
});

export default router;
