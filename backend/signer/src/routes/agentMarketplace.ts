/**
 * Agent Marketplace Routes
 *
 * Full task lifecycle endpoints for agents to interact with the RoseMarketplace contract.
 * Generates calldata + passport signatures so agents can execute on-chain transactions.
 *
 * Task Lifecycle:
 *   1. Create Task (customer deposits ROSE) → StakeholderRequired
 *   2. Stakeholder Stake (10% vROSE collateral) → Open
 *   3. Claim Task (worker assigned) → InProgress
 *   4. Mark Completed (worker submits PR URL) → Completed
 *   5. Approve (customer + stakeholder) → ApprovedPendingPayment
 *   6. Accept Payment (worker claims funds) → Closed
 *
 * Plus: cancel, unclaim, dispute, auction flows.
 *
 * All endpoints require API key authentication (bypasses Gitcoin Passport).
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { agentAuth } from '../middleware/agentAuth';
import { signApproval } from '../services/signer';
import { config } from '../config';
import { getMarketplaceContract, getTreasuryContract, getHttpProvider } from '../utils/contracts';

const router = Router();

// All marketplace endpoints require agent authentication
router.use(agentAuth);

// ============================================================
// Minimal ABIs for calldata encoding
// ============================================================

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const MARKETPLACE_CREATE_TASK_ABI = [
  'function createTask(string title, uint256 tokenAmount, string detailedDescriptionHash, bool githubIntegration, uint256 expiry, bytes signature)',
];

const MARKETPLACE_CREATE_AUCTION_ABI = [
  'function createAuctionTask(string title, uint256 maxBudget, string detailedDescriptionHash, bool githubIntegration, uint256 expiry, bytes signature)',
];

const MARKETPLACE_CLAIM_TASK_ABI = [
  'function claimTask(uint256 taskId, uint256 expiry, bytes signature)',
];

const MARKETPLACE_MARK_COMPLETED_ABI = [
  'function markTaskCompleted(uint256 taskId, string prUrl)',
];

const MARKETPLACE_ACCEPT_PAYMENT_ABI = [
  'function acceptPayment(uint256 taskId)',
];

const MARKETPLACE_CANCEL_TASK_ABI = [
  'function cancelTask(uint256 taskId)',
];

const MARKETPLACE_UNCLAIM_TASK_ABI = [
  'function unclaimTask(uint256 taskId)',
];

// ============================================================
// Token address cache
// ============================================================

let roseTokenAddress: string | null = null;

async function getRoseTokenAddress(): Promise<string> {
  if (roseTokenAddress) return roseTokenAddress;
  const marketplace = getMarketplaceContract(getHttpProvider());
  roseTokenAddress = await marketplace.roseToken() as string;
  return roseTokenAddress;
}

// ============================================================
// Helpers
// ============================================================

/** Upper bound: 1 billion ROSE */
const MAX_ROSE_AMOUNT = ethers.parseUnits('1000000000', 18);

/**
 * Parse and validate a ROSE amount string (human-readable, 18 decimals).
 */
function parseRoseAmount(amount: string): bigint | null {
  try {
    const wei = ethers.parseUnits(amount, 18);
    if (wei <= 0n) return null;
    if (wei > MAX_ROSE_AMOUNT) return null;
    return wei;
  } catch {
    return null;
  }
}

/** Task status enum matching contract */
const TaskStatusNames: Record<number, string> = {
  0: 'Open',
  1: 'StakeholderRequired',
  2: 'InProgress',
  3: 'Completed',
  4: 'Closed',
  5: 'ApprovedPendingPayment',
  6: 'Disputed',
};

// ============================================================
// TASK CREATION
// ============================================================

/**
 * POST /api/agent/marketplace/tasks
 * Create a new task on the marketplace. Returns calldata + signatures for on-chain execution.
 *
 * The agent executes two on-chain transactions:
 *   1. approve(marketplace, roseAmount) on the ROSE token
 *   2. createTask(title, amount, descHash, githubIntegration, expiry, signature) on Marketplace
 *
 * Body:
 * - title: Task title (string, max 200 chars)
 * - amount: ROSE deposit amount (string, e.g. "100")
 * - descriptionHash: IPFS hash of detailed description (string)
 * - githubIntegration: Whether PR URL required on completion (boolean, default true)
 * - isAuction: Create as auction task (boolean, default false)
 */
router.post('/marketplace/tasks', async (req: Request, res: Response) => {
  try {
    const { title, amount, descriptionHash, githubIntegration = true, isAuction = false } = req.body;

    // Validate inputs
    if (!title || typeof title !== 'string' || title.length === 0) {
      return res.status(400).json({ error: 'title is required (non-empty string)' });
    }
    if (title.length > 200) {
      return res.status(400).json({ error: 'title must be 200 characters or less' });
    }
    if (!amount || typeof amount !== 'string') {
      return res.status(400).json({ error: 'amount is required (string, e.g. "100" for 100 ROSE)' });
    }
    if (!descriptionHash || typeof descriptionHash !== 'string') {
      return res.status(400).json({ error: 'descriptionHash is required (IPFS hash string)' });
    }

    const roseAmountWei = parseRoseAmount(amount);
    if (!roseAmountWei) {
      return res.status(400).json({ error: 'Invalid amount — must be a positive number (max 1 billion ROSE)' });
    }

    const agentAddress = req.agent!.walletAddress;
    const marketplaceAddress = config.contracts.marketplace;

    if (!marketplaceAddress) {
      return res.status(500).json({ error: 'Marketplace contract not configured' });
    }

    const roseToken = await getRoseTokenAddress();

    // Sign passport approval (bypasses Gitcoin Passport for agents)
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
    const signature = await signApproval(agentAddress, 'createTask', expiry);

    // Encode calldata for both transactions
    const erc20Iface = new ethers.Interface(ERC20_ABI);
    const approveCalldata = erc20Iface.encodeFunctionData('approve', [
      marketplaceAddress,
      roseAmountWei,
    ]);

    let createCalldata: string;
    let methodName: string;

    if (isAuction) {
      const auctionIface = new ethers.Interface(MARKETPLACE_CREATE_AUCTION_ABI);
      createCalldata = auctionIface.encodeFunctionData('createAuctionTask', [
        title,
        roseAmountWei,
        descriptionHash,
        githubIntegration,
        expiry,
        signature,
      ]);
      methodName = 'createAuctionTask';
    } else {
      const taskIface = new ethers.Interface(MARKETPLACE_CREATE_TASK_ABI);
      createCalldata = taskIface.encodeFunctionData('createTask', [
        title,
        roseAmountWei,
        descriptionHash,
        githubIntegration,
        expiry,
        signature,
      ]);
      methodName = 'createTask';
    }

    console.log(
      `[AgentMarketplace] Create ${isAuction ? 'auction ' : ''}task params generated for ${agentAddress}: "${title}" (${amount} ROSE)`
    );

    return res.json({
      success: true,
      agent: agentAddress,
      title,
      amount,
      amountWei: roseAmountWei.toString(),
      isAuction,
      githubIntegration,
      descriptionHash,
      approval: {
        expiry,
        signature,
      },
      transactions: [
        {
          step: 1,
          description: 'Approve ROSE spending by Marketplace contract',
          to: roseToken,
          calldata: approveCalldata,
          function: 'approve(address,uint256)',
          args: [marketplaceAddress, roseAmountWei.toString()],
        },
        {
          step: 2,
          description: `Create ${isAuction ? 'auction ' : ''}task on the marketplace`,
          to: marketplaceAddress,
          calldata: createCalldata,
          function: methodName,
          args: isAuction
            ? [title, roseAmountWei.toString(), descriptionHash, githubIntegration, expiry, signature]
            : [title, roseAmountWei.toString(), descriptionHash, githubIntegration, expiry, signature],
        },
      ],
      castCommands: {
        approve: `cast send ${roseToken} "approve(address,uint256)" ${marketplaceAddress} ${roseAmountWei} --rpc-url ${config.rpc.url}`,
        createTask: `cast send ${marketplaceAddress} "${methodName === 'createAuctionTask'
          ? 'createAuctionTask(string,uint256,string,bool,uint256,bytes)'
          : 'createTask(string,uint256,string,bool,uint256,bytes)'
        }" "${title}" ${roseAmountWei} "${descriptionHash}" ${githubIntegration} ${expiry} ${signature} --rpc-url ${config.rpc.url}`,
      },
    });
  } catch (error) {
    console.error('[AgentMarketplace] Create task error:', error);
    return res.status(500).json({ error: 'Failed to generate task creation parameters' });
  }
});

// ============================================================
// TASK CLAIMING
// ============================================================

/**
 * POST /api/agent/marketplace/tasks/:id/claim
 * Claim an open task as a worker. Returns calldata + signature for on-chain execution.
 */
router.post('/marketplace/tasks/:id/claim', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || taskId < 1) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const agentAddress = req.agent!.walletAddress;
    const marketplaceAddress = config.contracts.marketplace;

    if (!marketplaceAddress) {
      return res.status(500).json({ error: 'Marketplace contract not configured' });
    }

    // Verify task exists and is claimable
    const provider = getHttpProvider();
    const marketplace = getMarketplaceContract(provider);
    const task = await marketplace.tasks(taskId);

    if (task.customer === ethers.ZeroAddress) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (Number(task.status) !== 0) { // 0 = Open
      return res.status(400).json({
        error: `Task is not Open (current status: ${TaskStatusNames[Number(task.status)] || task.status})`,
      });
    }
    if (task.customer.toLowerCase() === agentAddress.toLowerCase()) {
      return res.status(400).json({ error: 'Customer cannot claim their own task' });
    }
    if (task.isAuction) {
      return res.status(400).json({ error: 'Auction tasks use selectAuctionWinner, not claimTask' });
    }

    // Sign passport approval
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
    const signature = await signApproval(agentAddress, 'claim', expiry);

    // Encode calldata
    const iface = new ethers.Interface(MARKETPLACE_CLAIM_TASK_ABI);
    const calldata = iface.encodeFunctionData('claimTask', [taskId, expiry, signature]);

    console.log(`[AgentMarketplace] Claim task ${taskId} params generated for ${agentAddress}`);

    return res.json({
      success: true,
      agent: agentAddress,
      taskId,
      title: task.title,
      deposit: task.deposit.toString(),
      depositFormatted: ethers.formatUnits(task.deposit, 18),
      approval: { expiry, signature },
      transaction: {
        description: `Claim task #${taskId} as worker`,
        to: marketplaceAddress,
        calldata,
        function: 'claimTask(uint256,uint256,bytes)',
        args: [taskId, expiry, signature],
      },
      castCommand: `cast send ${marketplaceAddress} "claimTask(uint256,uint256,bytes)" ${taskId} ${expiry} ${signature} --rpc-url ${config.rpc.url}`,
    });
  } catch (error) {
    console.error('[AgentMarketplace] Claim task error:', error);
    return res.status(500).json({ error: 'Failed to generate claim parameters' });
  }
});

// ============================================================
// TASK COMPLETION
// ============================================================

/**
 * POST /api/agent/marketplace/tasks/:id/complete
 * Mark a task as completed (worker submits PR URL). Returns calldata for on-chain execution.
 *
 * Body:
 * - prUrl: Pull request or deliverable URL (required if githubIntegration is true)
 */
router.post('/marketplace/tasks/:id/complete', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || taskId < 1) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const { prUrl = '' } = req.body;
    const agentAddress = req.agent!.walletAddress;
    const marketplaceAddress = config.contracts.marketplace;

    if (!marketplaceAddress) {
      return res.status(500).json({ error: 'Marketplace contract not configured' });
    }

    // Verify task state
    const provider = getHttpProvider();
    const marketplace = getMarketplaceContract(provider);
    const task = await marketplace.tasks(taskId);

    if (task.customer === ethers.ZeroAddress) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.worker.toLowerCase() !== agentAddress.toLowerCase()) {
      return res.status(403).json({ error: 'Only the assigned worker can mark completion' });
    }
    if (Number(task.status) !== 2) { // 2 = InProgress
      return res.status(400).json({
        error: `Task is not InProgress (current status: ${TaskStatusNames[Number(task.status)] || task.status})`,
      });
    }
    if (task.githubIntegration && (!prUrl || typeof prUrl !== 'string' || prUrl.length === 0)) {
      return res.status(400).json({ error: 'prUrl is required for this task (GitHub integration enabled)' });
    }

    // Encode calldata (no passport signature needed for markTaskCompleted)
    const iface = new ethers.Interface(MARKETPLACE_MARK_COMPLETED_ABI);
    const calldata = iface.encodeFunctionData('markTaskCompleted', [taskId, prUrl]);

    console.log(`[AgentMarketplace] Complete task ${taskId} params generated for ${agentAddress}`);

    return res.json({
      success: true,
      agent: agentAddress,
      taskId,
      prUrl,
      transaction: {
        description: `Mark task #${taskId} as completed`,
        to: marketplaceAddress,
        calldata,
        function: 'markTaskCompleted(uint256,string)',
        args: [taskId, prUrl],
      },
      castCommand: `cast send ${marketplaceAddress} "markTaskCompleted(uint256,string)" ${taskId} "${prUrl}" --rpc-url ${config.rpc.url}`,
    });
  } catch (error) {
    console.error('[AgentMarketplace] Complete task error:', error);
    return res.status(500).json({ error: 'Failed to generate completion parameters' });
  }
});

// ============================================================
// PAYMENT ACCEPTANCE
// ============================================================

/**
 * POST /api/agent/marketplace/tasks/:id/accept-payment
 * Accept payment for an approved task (worker claims funds). Returns calldata.
 */
router.post('/marketplace/tasks/:id/accept-payment', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || taskId < 1) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const agentAddress = req.agent!.walletAddress;
    const marketplaceAddress = config.contracts.marketplace;

    if (!marketplaceAddress) {
      return res.status(500).json({ error: 'Marketplace contract not configured' });
    }

    // Verify task state
    const provider = getHttpProvider();
    const marketplace = getMarketplaceContract(provider);
    const task = await marketplace.tasks(taskId);

    if (task.customer === ethers.ZeroAddress) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.worker.toLowerCase() !== agentAddress.toLowerCase()) {
      return res.status(403).json({ error: 'Only the assigned worker can accept payment' });
    }
    if (Number(task.status) !== 5) { // 5 = ApprovedPendingPayment
      return res.status(400).json({
        error: `Task is not ApprovedPendingPayment (current status: ${TaskStatusNames[Number(task.status)] || task.status})`,
      });
    }

    // Encode calldata
    const iface = new ethers.Interface(MARKETPLACE_ACCEPT_PAYMENT_ABI);
    const calldata = iface.encodeFunctionData('acceptPayment', [taskId]);

    // Calculate expected payout
    const taskValue = task.isAuction ? task.winningBid : task.deposit;
    const workerAmount = (BigInt(taskValue) * 95n) / 100n;

    console.log(`[AgentMarketplace] Accept payment for task ${taskId} by ${agentAddress}`);

    return res.json({
      success: true,
      agent: agentAddress,
      taskId,
      expectedPayout: {
        workerAmount: workerAmount.toString(),
        workerAmountFormatted: ethers.formatUnits(workerAmount, 18),
        percentage: '95%',
      },
      transaction: {
        description: `Accept payment for task #${taskId} (95% of deposit)`,
        to: marketplaceAddress,
        calldata,
        function: 'acceptPayment(uint256)',
        args: [taskId],
      },
      castCommand: `cast send ${marketplaceAddress} "acceptPayment(uint256)" ${taskId} --rpc-url ${config.rpc.url}`,
    });
  } catch (error) {
    console.error('[AgentMarketplace] Accept payment error:', error);
    return res.status(500).json({ error: 'Failed to generate payment acceptance parameters' });
  }
});

// ============================================================
// CANCEL & UNCLAIM
// ============================================================

/**
 * POST /api/agent/marketplace/tasks/:id/cancel
 * Cancel a task before a worker claims it. Returns calldata.
 */
router.post('/marketplace/tasks/:id/cancel', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || taskId < 1) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const agentAddress = req.agent!.walletAddress;
    const marketplaceAddress = config.contracts.marketplace;

    if (!marketplaceAddress) {
      return res.status(500).json({ error: 'Marketplace contract not configured' });
    }

    // Verify task state
    const provider = getHttpProvider();
    const marketplace = getMarketplaceContract(provider);
    const task = await marketplace.tasks(taskId);

    if (task.customer === ethers.ZeroAddress) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const status = Number(task.status);
    if (status !== 0 && status !== 1) { // Open or StakeholderRequired
      return res.status(400).json({
        error: `Task can only be cancelled in Open or StakeholderRequired status (current: ${TaskStatusNames[status] || status})`,
      });
    }

    const isCustomer = task.customer.toLowerCase() === agentAddress.toLowerCase();
    const isStakeholder = task.stakeholder.toLowerCase() === agentAddress.toLowerCase();
    if (!isCustomer && !isStakeholder) {
      return res.status(403).json({ error: 'Only the customer or stakeholder can cancel' });
    }

    // Encode calldata
    const iface = new ethers.Interface(MARKETPLACE_CANCEL_TASK_ABI);
    const calldata = iface.encodeFunctionData('cancelTask', [taskId]);

    console.log(`[AgentMarketplace] Cancel task ${taskId} by ${agentAddress}`);

    return res.json({
      success: true,
      agent: agentAddress,
      taskId,
      role: isCustomer ? 'customer' : 'stakeholder',
      refunds: {
        customerDeposit: task.deposit.toString(),
        customerDepositFormatted: ethers.formatUnits(task.deposit, 18),
        stakeholderDeposit: task.stakeholderDeposit.toString(),
        stakeholderDepositFormatted: ethers.formatUnits(task.stakeholderDeposit, 18),
      },
      transaction: {
        description: `Cancel task #${taskId} and refund deposits`,
        to: marketplaceAddress,
        calldata,
        function: 'cancelTask(uint256)',
        args: [taskId],
      },
      castCommand: `cast send ${marketplaceAddress} "cancelTask(uint256)" ${taskId} --rpc-url ${config.rpc.url}`,
    });
  } catch (error) {
    console.error('[AgentMarketplace] Cancel task error:', error);
    return res.status(500).json({ error: 'Failed to generate cancel parameters' });
  }
});

/**
 * POST /api/agent/marketplace/tasks/:id/unclaim
 * Unclaim a task (worker withdraws). Returns calldata.
 */
router.post('/marketplace/tasks/:id/unclaim', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || taskId < 1) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const agentAddress = req.agent!.walletAddress;
    const marketplaceAddress = config.contracts.marketplace;

    if (!marketplaceAddress) {
      return res.status(500).json({ error: 'Marketplace contract not configured' });
    }

    // Verify task state
    const provider = getHttpProvider();
    const marketplace = getMarketplaceContract(provider);
    const task = await marketplace.tasks(taskId);

    if (task.customer === ethers.ZeroAddress) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.worker.toLowerCase() !== agentAddress.toLowerCase()) {
      return res.status(403).json({ error: 'Only the assigned worker can unclaim' });
    }
    if (Number(task.status) !== 2) { // InProgress
      return res.status(400).json({
        error: `Task must be InProgress to unclaim (current: ${TaskStatusNames[Number(task.status)] || task.status})`,
      });
    }

    // Encode calldata
    const iface = new ethers.Interface(MARKETPLACE_UNCLAIM_TASK_ABI);
    const calldata = iface.encodeFunctionData('unclaimTask', [taskId]);

    console.log(`[AgentMarketplace] Unclaim task ${taskId} by ${agentAddress}`);

    return res.json({
      success: true,
      agent: agentAddress,
      taskId,
      transaction: {
        description: `Unclaim task #${taskId} (return to Open status)`,
        to: marketplaceAddress,
        calldata,
        function: 'unclaimTask(uint256)',
        args: [taskId],
      },
      castCommand: `cast send ${marketplaceAddress} "unclaimTask(uint256)" ${taskId} --rpc-url ${config.rpc.url}`,
    });
  } catch (error) {
    console.error('[AgentMarketplace] Unclaim task error:', error);
    return res.status(500).json({ error: 'Failed to generate unclaim parameters' });
  }
});

export default router;
