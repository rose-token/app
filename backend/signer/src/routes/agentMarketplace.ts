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
import { getBidsForTask } from '../services/auction';

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

const MARKETPLACE_STAKEHOLDER_STAKE_ABI = [
  'function stakeholderStake(uint256 taskId, uint256 tokenAmount, uint256 expiry, bytes signature)',
];

const MARKETPLACE_UNSTAKE_STAKEHOLDER_ABI = [
  'function unstakeStakeholder(uint256 taskId)',
];

const MARKETPLACE_SELECT_AUCTION_WINNER_ABI = [
  'function selectAuctionWinner(uint256 taskId, address worker, uint256 winningBid, uint256 expiry, bytes signature)',
];

const MARKETPLACE_APPROVE_CUSTOMER_ABI = [
  'function approveCompletionByCustomer(uint256 taskId)',
];

const MARKETPLACE_APPROVE_STAKEHOLDER_ABI = [
  'function approveCompletionByStakeholder(uint256 taskId)',
];

const MARKETPLACE_DISPUTE_CUSTOMER_ABI = [
  'function disputeTaskAsCustomer(uint256 taskId, string reasonHash)',
];

const MARKETPLACE_DISPUTE_WORKER_ABI = [
  'function disputeTaskAsWorker(uint256 taskId, string reasonHash)',
];

const VROSE_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

// ============================================================
// Token address cache
// ============================================================

let roseTokenAddress: string | null = null;
let vRoseTokenAddress: string | null = null;

async function getRoseTokenAddress(): Promise<string> {
  if (roseTokenAddress) return roseTokenAddress;
  const marketplace = getMarketplaceContract(getHttpProvider());
  roseTokenAddress = await marketplace.roseToken() as string;
  return roseTokenAddress;
}

async function getVRoseTokenAddress(): Promise<string> {
  if (vRoseTokenAddress) return vRoseTokenAddress;
  const marketplace = getMarketplaceContract(getHttpProvider());
  vRoseTokenAddress = await marketplace.vRoseToken() as string;
  return vRoseTokenAddress;
}

/**
 * Sign selectAuctionWinner approval.
 * Message: keccak256(abi.encodePacked(customer, "selectWinner", taskId, worker, winningBid, expiry))
 */
async function signSelectWinnerApproval(
  customer: string,
  taskId: number,
  worker: string,
  winningBid: bigint,
  expiry: number
): Promise<string> {
  const wallet = new ethers.Wallet(config.signer.privateKey);
  const messageHash = ethers.solidityPackedKeccak256(
    ['address', 'string', 'uint256', 'address', 'uint256', 'uint256'],
    [customer, 'selectWinner', taskId, worker, winningBid, expiry]
  );
  return wallet.signMessage(ethers.getBytes(messageHash));
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

// ============================================================
// STAKEHOLDER STAKING
// ============================================================

/**
 * POST /api/agent/marketplace/tasks/:id/stake
 * Stake as stakeholder (10% vROSE collateral). Returns calldata + signature.
 */
router.post('/marketplace/tasks/:id/stake', async (req: Request, res: Response) => {
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
    if (Number(task.status) !== 1) { // 1 = StakeholderRequired
      return res.status(400).json({
        error: `Task is not awaiting stakeholder (current status: ${TaskStatusNames[Number(task.status)] || task.status})`,
      });
    }
    if (task.customer.toLowerCase() === agentAddress.toLowerCase()) {
      return res.status(400).json({ error: 'Customer cannot be stakeholder for their own task' });
    }

    // Calculate required 10% deposit
    const requiredDeposit = BigInt(task.deposit) / 10n;
    const vRoseToken = await getVRoseTokenAddress();

    // Sign passport approval
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
    const signature = await signApproval(agentAddress, 'stake', expiry);

    // Encode calldata: approve vROSE + stakeholderStake
    const vRoseIface = new ethers.Interface(VROSE_ABI);
    const approveCalldata = vRoseIface.encodeFunctionData('approve', [
      marketplaceAddress,
      requiredDeposit,
    ]);

    const stakeIface = new ethers.Interface(MARKETPLACE_STAKEHOLDER_STAKE_ABI);
    const stakeCalldata = stakeIface.encodeFunctionData('stakeholderStake', [
      taskId,
      requiredDeposit,
      expiry,
      signature,
    ]);

    console.log(`[AgentMarketplace] Stake on task ${taskId} by ${agentAddress}: ${ethers.formatUnits(requiredDeposit, 18)} vROSE`);

    return res.json({
      success: true,
      agent: agentAddress,
      taskId,
      title: task.title,
      taskDeposit: task.deposit.toString(),
      taskDepositFormatted: ethers.formatUnits(task.deposit, 18),
      requiredStake: requiredDeposit.toString(),
      requiredStakeFormatted: ethers.formatUnits(requiredDeposit, 18),
      approval: { expiry, signature },
      transactions: [
        {
          step: 1,
          description: 'Approve vROSE spending by Marketplace contract',
          to: vRoseToken,
          calldata: approveCalldata,
          function: 'approve(address,uint256)',
          args: [marketplaceAddress, requiredDeposit.toString()],
        },
        {
          step: 2,
          description: `Stake ${ethers.formatUnits(requiredDeposit, 18)} vROSE as stakeholder for task #${taskId}`,
          to: marketplaceAddress,
          calldata: stakeCalldata,
          function: 'stakeholderStake(uint256,uint256,uint256,bytes)',
          args: [taskId, requiredDeposit.toString(), expiry, signature],
        },
      ],
      castCommands: {
        approve: `cast send ${vRoseToken} "approve(address,uint256)" ${marketplaceAddress} ${requiredDeposit} --rpc-url ${config.rpc.url}`,
        stake: `cast send ${marketplaceAddress} "stakeholderStake(uint256,uint256,uint256,bytes)" ${taskId} ${requiredDeposit} ${expiry} ${signature} --rpc-url ${config.rpc.url}`,
      },
    });
  } catch (error) {
    console.error('[AgentMarketplace] Stake error:', error);
    return res.status(500).json({ error: 'Failed to generate stake parameters' });
  }
});

/**
 * POST /api/agent/marketplace/tasks/:id/unstake
 * Unstake as stakeholder (before worker claims). Returns calldata.
 */
router.post('/marketplace/tasks/:id/unstake', async (req: Request, res: Response) => {
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

    const provider = getHttpProvider();
    const marketplace = getMarketplaceContract(provider);
    const task = await marketplace.tasks(taskId);

    if (task.customer === ethers.ZeroAddress) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.stakeholder.toLowerCase() !== agentAddress.toLowerCase()) {
      return res.status(403).json({ error: 'Only the stakeholder can unstake' });
    }
    if (Number(task.status) !== 0) { // Open
      return res.status(400).json({
        error: `Task must be Open to unstake (current: ${TaskStatusNames[Number(task.status)] || task.status})`,
      });
    }

    const iface = new ethers.Interface(MARKETPLACE_UNSTAKE_STAKEHOLDER_ABI);
    const calldata = iface.encodeFunctionData('unstakeStakeholder', [taskId]);

    return res.json({
      success: true,
      agent: agentAddress,
      taskId,
      refund: {
        amount: task.stakeholderDeposit.toString(),
        amountFormatted: ethers.formatUnits(task.stakeholderDeposit, 18),
        token: 'vROSE',
      },
      transaction: {
        description: `Unstake from task #${taskId} (returns vROSE)`,
        to: marketplaceAddress,
        calldata,
        function: 'unstakeStakeholder(uint256)',
        args: [taskId],
      },
      castCommand: `cast send ${marketplaceAddress} "unstakeStakeholder(uint256)" ${taskId} --rpc-url ${config.rpc.url}`,
    });
  } catch (error) {
    console.error('[AgentMarketplace] Unstake error:', error);
    return res.status(500).json({ error: 'Failed to generate unstake parameters' });
  }
});

// ============================================================
// AUCTION: SELECT WINNER
// ============================================================

/**
 * POST /api/agent/marketplace/tasks/:id/select-winner
 * Customer selects winning bidder for an auction task. Returns calldata + signature.
 *
 * Body:
 * - worker: Address of the winning bidder
 * - winningBid: Winning bid amount in ROSE (string, e.g. "50")
 */
router.post('/marketplace/tasks/:id/select-winner', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || taskId < 1) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const { worker, winningBid } = req.body;

    if (!worker || typeof worker !== 'string' || !ethers.isAddress(worker)) {
      return res.status(400).json({ error: 'worker is required (valid Ethereum address)' });
    }
    if (!winningBid || typeof winningBid !== 'string') {
      return res.status(400).json({ error: 'winningBid is required (string, e.g. "50" for 50 ROSE)' });
    }

    const bidAmountWei = parseRoseAmount(winningBid);
    if (!bidAmountWei) {
      return res.status(400).json({ error: 'Invalid winningBid — must be a positive number' });
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
    if (task.customer.toLowerCase() !== agentAddress.toLowerCase()) {
      return res.status(403).json({ error: 'Only the customer can select auction winner' });
    }
    if (!task.isAuction) {
      return res.status(400).json({ error: 'This is not an auction task' });
    }
    if (Number(task.status) !== 0) { // Open
      return res.status(400).json({
        error: `Task must be Open to select winner (current: ${TaskStatusNames[Number(task.status)] || task.status})`,
      });
    }
    if (bidAmountWei > BigInt(task.deposit)) {
      return res.status(400).json({ error: 'Winning bid cannot exceed max budget (deposit)' });
    }

    // Sign selectWinner approval (custom signature format)
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
    const signature = await signSelectWinnerApproval(
      agentAddress, taskId, worker, bidAmountWei, expiry
    );

    // Encode calldata
    const iface = new ethers.Interface(MARKETPLACE_SELECT_AUCTION_WINNER_ABI);
    const calldata = iface.encodeFunctionData('selectAuctionWinner', [
      taskId, worker, bidAmountWei, expiry, signature,
    ]);

    // Calculate surplus refund
    const surplus = BigInt(task.deposit) - bidAmountWei;

    console.log(`[AgentMarketplace] Select winner for task ${taskId}: worker=${worker}, bid=${winningBid} ROSE`);

    return res.json({
      success: true,
      agent: agentAddress,
      taskId,
      worker,
      winningBid,
      winningBidWei: bidAmountWei.toString(),
      maxBudget: task.deposit.toString(),
      maxBudgetFormatted: ethers.formatUnits(task.deposit, 18),
      surplus: {
        amount: surplus.toString(),
        amountFormatted: ethers.formatUnits(surplus, 18),
        note: 'Surplus split: half refunded to customer, half captured as spread to treasury',
      },
      approval: { expiry, signature },
      transaction: {
        description: `Select ${worker} as winner of auction task #${taskId} at ${winningBid} ROSE`,
        to: marketplaceAddress,
        calldata,
        function: 'selectAuctionWinner(uint256,address,uint256,uint256,bytes)',
        args: [taskId, worker, bidAmountWei.toString(), expiry, signature],
      },
      castCommand: `cast send ${marketplaceAddress} "selectAuctionWinner(uint256,address,uint256,uint256,bytes)" ${taskId} ${worker} ${bidAmountWei} ${expiry} ${signature} --rpc-url ${config.rpc.url}`,
    });
  } catch (error) {
    console.error('[AgentMarketplace] Select winner error:', error);
    return res.status(500).json({ error: 'Failed to generate select winner parameters' });
  }
});

// ============================================================
// AUCTION: ACCEPT BID
// ============================================================

/**
 * POST /api/agent/marketplace/tasks/:id/accept-bid
 * Accept a specific bid on an auction task. Convenience wrapper around selectAuctionWinner
 * that looks up the bid by worker address.
 *
 * Body:
 * - worker: Address of the bidder to accept
 */
router.post('/marketplace/tasks/:id/accept-bid', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || taskId < 1) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const { worker } = req.body;

    if (!worker || typeof worker !== 'string' || !ethers.isAddress(worker)) {
      return res.status(400).json({ error: 'worker is required (valid Ethereum address of the bidder)' });
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
    if (task.customer.toLowerCase() !== agentAddress.toLowerCase()) {
      return res.status(403).json({ error: 'Only the customer can accept bids' });
    }
    if (!task.isAuction) {
      return res.status(400).json({ error: 'This is not an auction task' });
    }
    if (Number(task.status) !== 0) { // Open
      return res.status(400).json({
        error: `Task must be Open to accept a bid (current: ${TaskStatusNames[Number(task.status)] || task.status})`,
      });
    }

    // Look up the bid
    const bidsResponse = await getBidsForTask(taskId);
    const bid = bidsResponse.bids.find(
      (b) => b.worker.toLowerCase() === worker.toLowerCase()
    );

    if (!bid) {
      return res.status(404).json({ error: `No bid found from worker ${worker}` });
    }

    const bidAmountWei = BigInt(bid.bidAmount);

    if (bidAmountWei > BigInt(task.deposit)) {
      return res.status(400).json({ error: 'Bid amount exceeds max budget (deposit)' });
    }

    // Sign selectWinner approval
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
    const signature = await signSelectWinnerApproval(
      agentAddress, taskId, worker, bidAmountWei, expiry
    );

    // Encode calldata
    const iface = new ethers.Interface(MARKETPLACE_SELECT_AUCTION_WINNER_ABI);
    const calldata = iface.encodeFunctionData('selectAuctionWinner', [
      taskId, worker, bidAmountWei, expiry, signature,
    ]);

    // Calculate surplus refund
    const surplus = BigInt(task.deposit) - bidAmountWei;

    console.log(`[AgentMarketplace] Accept bid for task ${taskId}: worker=${worker}, bid=${ethers.formatUnits(bidAmountWei, 18)} ROSE`);

    return res.json({
      success: true,
      agent: agentAddress,
      taskId,
      worker,
      bidAmount: bid.bidAmount,
      bidAmountFormatted: ethers.formatUnits(bidAmountWei, 18),
      displayBid: bid.displayBid,
      displayBidFormatted: ethers.formatUnits(BigInt(bid.displayBid), 18),
      message: bid.message,
      maxBudget: task.deposit.toString(),
      maxBudgetFormatted: ethers.formatUnits(task.deposit, 18),
      surplus: {
        amount: surplus.toString(),
        amountFormatted: ethers.formatUnits(surplus, 18),
        note: 'Surplus split: half refunded to customer, half captured as spread to treasury',
      },
      approval: { expiry, signature },
      transaction: {
        description: `Accept bid from ${worker} on auction task #${taskId} at ${ethers.formatUnits(bidAmountWei, 18)} ROSE`,
        to: marketplaceAddress,
        calldata,
        function: 'selectAuctionWinner(uint256,address,uint256,uint256,bytes)',
        args: [taskId, worker, bidAmountWei.toString(), expiry, signature],
      },
      castCommand: `cast send ${marketplaceAddress} "selectAuctionWinner(uint256,address,uint256,uint256,bytes)" ${taskId} ${worker} ${bidAmountWei} ${expiry} ${signature} --rpc-url ${config.rpc.url}`,
    });
  } catch (error: any) {
    console.error('[AgentMarketplace] Accept bid error:', error);
    if (error.message?.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to generate accept bid parameters' });
  }
});

// ============================================================
// APPROVALS
// ============================================================

/**
 * POST /api/agent/marketplace/tasks/:id/approve
 * Approve completed work (as customer or stakeholder). Returns calldata.
 * Automatically detects role based on the authenticated agent's wallet.
 */
router.post('/marketplace/tasks/:id/approve', async (req: Request, res: Response) => {
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

    const provider = getHttpProvider();
    const marketplace = getMarketplaceContract(provider);
    const task = await marketplace.tasks(taskId);

    if (task.customer === ethers.ZeroAddress) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (Number(task.status) !== 3) { // 3 = Completed
      return res.status(400).json({
        error: `Task must be Completed to approve (current: ${TaskStatusNames[Number(task.status)] || task.status})`,
      });
    }

    const isCustomer = task.customer.toLowerCase() === agentAddress.toLowerCase();
    const isStakeholder = task.stakeholder.toLowerCase() === agentAddress.toLowerCase();

    if (!isCustomer && !isStakeholder) {
      return res.status(403).json({ error: 'Only the customer or stakeholder can approve' });
    }

    let calldata: string;
    let role: string;
    let functionSig: string;

    if (isCustomer) {
      if (task.customerApproval) {
        return res.status(400).json({ error: 'Customer has already approved' });
      }
      const iface = new ethers.Interface(MARKETPLACE_APPROVE_CUSTOMER_ABI);
      calldata = iface.encodeFunctionData('approveCompletionByCustomer', [taskId]);
      role = 'customer';
      functionSig = 'approveCompletionByCustomer(uint256)';
    } else {
      if (task.stakeholderApproval) {
        return res.status(400).json({ error: 'Stakeholder has already approved' });
      }
      const iface = new ethers.Interface(MARKETPLACE_APPROVE_STAKEHOLDER_ABI);
      calldata = iface.encodeFunctionData('approveCompletionByStakeholder', [taskId]);
      role = 'stakeholder';
      functionSig = 'approveCompletionByStakeholder(uint256)';
    }

    const otherApproved = isCustomer ? task.stakeholderApproval : task.customerApproval;

    console.log(`[AgentMarketplace] Approve task ${taskId} as ${role} by ${agentAddress}`);

    return res.json({
      success: true,
      agent: agentAddress,
      taskId,
      role,
      otherPartyApproved: otherApproved,
      willTriggerPayment: otherApproved,
      note: otherApproved
        ? 'Both approvals will be met — task moves to ApprovedPendingPayment'
        : `Waiting for ${isCustomer ? 'stakeholder' : 'customer'} approval`,
      transaction: {
        description: `Approve task #${taskId} completion as ${role}`,
        to: marketplaceAddress,
        calldata,
        function: functionSig,
        args: [taskId],
      },
      castCommand: `cast send ${marketplaceAddress} "${functionSig}" ${taskId} --rpc-url ${config.rpc.url}`,
    });
  } catch (error) {
    console.error('[AgentMarketplace] Approve error:', error);
    return res.status(500).json({ error: 'Failed to generate approve parameters' });
  }
});

// ============================================================
// DISPUTES
// ============================================================

/**
 * POST /api/agent/marketplace/tasks/:id/dispute
 * Raise a dispute on a task. Returns calldata.
 * Customer can dispute InProgress tasks; worker can dispute Completed tasks.
 *
 * Body:
 * - reasonHash: IPFS hash of dispute reason (string)
 */
router.post('/marketplace/tasks/:id/dispute', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || taskId < 1) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const { reasonHash } = req.body;
    if (!reasonHash || typeof reasonHash !== 'string') {
      return res.status(400).json({ error: 'reasonHash is required (IPFS hash string)' });
    }

    const agentAddress = req.agent!.walletAddress;
    const marketplaceAddress = config.contracts.marketplace;

    if (!marketplaceAddress) {
      return res.status(500).json({ error: 'Marketplace contract not configured' });
    }

    const provider = getHttpProvider();
    const marketplace = getMarketplaceContract(provider);
    const task = await marketplace.tasks(taskId);

    if (task.customer === ethers.ZeroAddress) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.disputeInitiator !== ethers.ZeroAddress) {
      return res.status(400).json({ error: 'Dispute already raised on this task' });
    }

    const isCustomer = task.customer.toLowerCase() === agentAddress.toLowerCase();
    const isWorker = task.worker.toLowerCase() === agentAddress.toLowerCase();
    const status = Number(task.status);

    let calldata: string;
    let role: string;
    let functionSig: string;

    if (isCustomer && status === 2) { // InProgress
      const iface = new ethers.Interface(MARKETPLACE_DISPUTE_CUSTOMER_ABI);
      calldata = iface.encodeFunctionData('disputeTaskAsCustomer', [taskId, reasonHash]);
      role = 'customer';
      functionSig = 'disputeTaskAsCustomer(uint256,string)';
    } else if (isWorker && status === 3) { // Completed
      const iface = new ethers.Interface(MARKETPLACE_DISPUTE_WORKER_ABI);
      calldata = iface.encodeFunctionData('disputeTaskAsWorker', [taskId, reasonHash]);
      role = 'worker';
      functionSig = 'disputeTaskAsWorker(uint256,string)';
    } else if (isCustomer && status !== 2) {
      return res.status(400).json({ error: 'Customer can only dispute InProgress tasks' });
    } else if (isWorker && status !== 3) {
      return res.status(400).json({ error: 'Worker can only dispute Completed tasks (when approvals withheld)' });
    } else {
      return res.status(403).json({ error: 'Only the customer or worker can raise a dispute' });
    }

    console.log(`[AgentMarketplace] Dispute task ${taskId} as ${role} by ${agentAddress}`);

    return res.json({
      success: true,
      agent: agentAddress,
      taskId,
      role,
      reasonHash,
      transaction: {
        description: `Raise dispute on task #${taskId} as ${role}`,
        to: marketplaceAddress,
        calldata,
        function: functionSig,
        args: [taskId, reasonHash],
      },
      castCommand: `cast send ${marketplaceAddress} "${functionSig}" ${taskId} "${reasonHash}" --rpc-url ${config.rpc.url}`,
    });
  } catch (error) {
    console.error('[AgentMarketplace] Dispute error:', error);
    return res.status(500).json({ error: 'Failed to generate dispute parameters' });
  }
});

export default router;
