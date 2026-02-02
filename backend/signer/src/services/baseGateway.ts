/**
 * Base Gateway Watcher Service
 *
 * Watches DepositInitiated and RedeemRequested events on the Base-side
 * RoseBaseGateway contract and orchestrates the cross-chain flow:
 *
 * DEPOSIT FLOW:
 *   1. Agent calls gateway.deposit(usdcAmount) on Base
 *   2. Gateway burns USDC via CCTP depositForBurn → Arbitrum
 *   3. This watcher detects DepositInitiated event
 *   4. Polls Circle attestation API until attestation is ready
 *   5. Calls receiveMessage on Arbitrum MessageTransmitter to mint USDC
 *   6. Approves USDC + calls Treasury.deposit() on Arbitrum (using existing signApproval)
 *   7. Calls gateway.completeDeposit(nonce, roseAmount) on Base to credit agent
 *
 * REDEEM FLOW:
 *   1. Agent calls gateway.requestRedeem(roseAmount) on Base
 *   2. This watcher detects RedeemRequested event
 *   3. Signs approval + calls Treasury.redeem() on Arbitrum
 *   4. Bridges USDC back to Base via CCTP
 *   5. Polls Circle attestation, calls receiveMessage on Base
 *   6. Calls gateway.completeRedeem(redeemId, usdcAmount) on Base
 */

import { ethers } from 'ethers';
import { config } from '../config';
import { signApproval } from './signer';

// ──────────────────────────────────────────────
//  Configuration (env vars)
// ──────────────────────────────────────────────

const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const BASE_WS_URL = process.env.BASE_WS_URL || '';
const BASE_GATEWAY_ADDRESS = process.env.BASE_GATEWAY_ADDRESS || '';

// CCTP contract addresses
// Base mainnet
const BASE_TOKEN_MESSENGER = process.env.BASE_TOKEN_MESSENGER || '0x1682Ae6375C4E4A97e4B583BC394c861A46D8962';
const BASE_MESSAGE_TRANSMITTER = process.env.BASE_MESSAGE_TRANSMITTER || '0xAD09780d193884d503182aD4F75D113B9B6a7c79';
const BASE_USDC = process.env.BASE_USDC || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Arbitrum mainnet
const ARB_MESSAGE_TRANSMITTER = process.env.ARB_MESSAGE_TRANSMITTER || '0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca';
const ARB_USDC = process.env.ARB_USDC || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const ARB_TOKEN_MESSENGER = process.env.ARB_TOKEN_MESSENGER || '0x19330d10D9Cc8751218eaf51E8885D058642E08A';

// Circle CCTP attestation API
const CIRCLE_ATTESTATION_API = process.env.CIRCLE_ATTESTATION_API || 'https://iris-api.circle.com';

// CCTP domain IDs
const BASE_DOMAIN = 6;
const ARBITRUM_DOMAIN = 3;

// Polling config
const ATTESTATION_POLL_INTERVAL_MS = parseInt(process.env.ATTESTATION_POLL_INTERVAL_MS || '10000'); // 10s
const ATTESTATION_MAX_WAIT_MS = parseInt(process.env.ATTESTATION_MAX_WAIT_MS || '900000'); // 15 min
const STARTUP_BLOCK_LOOKBACK = parseInt(process.env.BASE_GATEWAY_STARTUP_LOOKBACK || '1000');

// ──────────────────────────────────────────────
//  ABIs (minimal)
// ──────────────────────────────────────────────

const GATEWAY_ABI = [
  'event DepositInitiated(address indexed agent, uint256 usdcAmount, uint64 indexed cctpNonce)',
  'event DepositCompleted(address indexed agent, uint256 usdcAmount, uint256 roseAmount, uint64 indexed cctpNonce)',
  'event RedeemRequested(address indexed agent, uint256 roseAmount, uint256 indexed redeemId)',
  'event RedeemCompleted(address indexed agent, uint256 usdcAmount, uint256 indexed redeemId)',
  'function completeDeposit(uint64 nonce, uint256 roseAmount) external',
  'function completeRedeem(uint256 redeemId, uint256 usdcAmount) external',
  'function cancelRedeem(uint256 redeemId) external',
  'function pendingDeposits(uint64) view returns (address agent, uint256 usdcAmount, bool completed)',
  'function pendingRedeems(uint256) view returns (address agent, uint256 roseAmount, bool completed)',
];

const MESSAGE_TRANSMITTER_ABI = [
  'function receiveMessage(bytes message, bytes attestation) external returns (bool success)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

const TOKEN_MESSENGER_ABI = [
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) external returns (uint64 nonce)',
];

const TREASURY_ABI = [
  'function deposit(uint256 usdcAmount, uint256 expiry, bytes signature) external',
  'function redeem(uint256 roseAmount, uint256 expiry, bytes signature) external',
  'function calculateRoseForDeposit(uint256 usdcAmount) view returns (uint256)',
  'function calculateUsdcForRedemption(uint256 roseAmount) view returns (uint256)',
  'function canRedeemInstantly(uint256 roseAmount) view returns (bool)',
  'function roseToken() view returns (address)',
  'function usdc() view returns (address)',
];

// ──────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────

export type CrossChainStatus =
  | 'pending'          // Event detected, waiting
  | 'bridging'         // CCTP burn done, waiting for attestation
  | 'attested'         // Attestation received
  | 'receiving'        // Calling receiveMessage
  | 'executing'        // Executing deposit/redeem on destination chain
  | 'completing'       // Calling completeDeposit/completeRedeem on Base
  | 'completed'        // All done
  | 'failed';          // Something went wrong

export interface PendingDepositInfo {
  cctpNonce: bigint;
  agent: string;
  usdcAmount: bigint;
  status: CrossChainStatus;
  baseTxHash: string;
  messageBytes?: string;
  messageHash?: string;
  attestation?: string;
  arbReceiveTxHash?: string;
  arbDepositTxHash?: string;
  baseCompleteTxHash?: string;
  roseAmount?: bigint;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export interface PendingRedeemInfo {
  redeemId: bigint;
  agent: string;
  roseAmount: bigint;
  status: CrossChainStatus;
  baseTxHash: string;
  usdcAmount?: bigint;
  arbRedeemTxHash?: string;
  cctpNonce?: bigint;
  messageBytes?: string;
  messageHash?: string;
  attestation?: string;
  baseReceiveTxHash?: string;
  baseCompleteTxHash?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export interface BaseGatewayStats {
  isRunning: boolean;
  startedAt: Date | null;
  depositsDetected: number;
  depositsCompleted: number;
  depositsFailed: number;
  redeemsDetected: number;
  redeemsCompleted: number;
  redeemsFailed: number;
  lastError: string | null;
  lastEventBlock: number;
}

// ──────────────────────────────────────────────
//  State
// ──────────────────────────────────────────────

// Providers & wallets
let baseHttpProvider: ethers.JsonRpcProvider | null = null;
let baseWsProvider: ethers.WebSocketProvider | null = null;
let arbHttpProvider: ethers.JsonRpcProvider | null = null;
let signerWallet: ethers.Wallet | null = null;

// Contracts
let gatewayContract: ethers.Contract | null = null;
let gatewayWsContract: ethers.Contract | null = null;

// Tracking
const pendingDeposits: Map<string, PendingDepositInfo> = new Map(); // keyed by nonce string
const pendingRedeems: Map<string, PendingRedeemInfo> = new Map();   // keyed by redeemId string

const stats: BaseGatewayStats = {
  isRunning: false,
  startedAt: null,
  depositsDetected: 0,
  depositsCompleted: 0,
  depositsFailed: 0,
  redeemsDetected: 0,
  redeemsCompleted: 0,
  redeemsFailed: 0,
  lastError: null,
  lastEventBlock: 0,
};

// ──────────────────────────────────────────────
//  Provider & Contract Helpers
// ──────────────────────────────────────────────

function getBaseHttpProvider(): ethers.JsonRpcProvider {
  if (!baseHttpProvider) {
    baseHttpProvider = new ethers.JsonRpcProvider(BASE_RPC_URL);
  }
  return baseHttpProvider;
}

function getBaseWsProvider(): ethers.WebSocketProvider {
  if (!baseWsProvider) {
    if (!BASE_WS_URL) {
      throw new Error('BASE_WS_URL not configured');
    }
    baseWsProvider = new ethers.WebSocketProvider(BASE_WS_URL);
  }
  return baseWsProvider;
}

function getArbHttpProvider(): ethers.JsonRpcProvider {
  if (!arbHttpProvider) {
    arbHttpProvider = new ethers.JsonRpcProvider(config.rpc.url);
  }
  return arbHttpProvider;
}

function getSignerWallet(): ethers.Wallet {
  if (!signerWallet) {
    signerWallet = new ethers.Wallet(config.signer.privateKey);
  }
  return signerWallet;
}

function getBaseSignerWallet(): ethers.Wallet {
  return getSignerWallet().connect(getBaseHttpProvider());
}

function getArbSignerWallet(): ethers.Wallet {
  return getSignerWallet().connect(getArbHttpProvider());
}

function getGatewayContract(): ethers.Contract {
  if (!gatewayContract) {
    gatewayContract = new ethers.Contract(
      BASE_GATEWAY_ADDRESS,
      GATEWAY_ABI,
      getBaseHttpProvider()
    );
  }
  return gatewayContract;
}

// ──────────────────────────────────────────────
//  CCTP Attestation Helper
// ──────────────────────────────────────────────

/**
 * Parse CCTP message bytes and hash from a transaction receipt.
 * Looks for MessageSent(bytes message) event from the MessageTransmitter.
 */
function parseCctpMessageFromReceipt(
  receipt: ethers.TransactionReceipt,
  messageTransmitterAddress: string
): { messageBytes: string; messageHash: string } | null {
  // MessageSent event topic: keccak256("MessageSent(bytes)")
  const MESSAGE_SENT_TOPIC = ethers.id('MessageSent(bytes)');

  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() === messageTransmitterAddress.toLowerCase() &&
      log.topics[0] === MESSAGE_SENT_TOPIC
    ) {
      // Decode the message bytes from the log data
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const [messageBytes] = abiCoder.decode(['bytes'], log.data);
      const messageHash = ethers.keccak256(messageBytes);
      return { messageBytes, messageHash };
    }
  }
  return null;
}

/**
 * Poll Circle's attestation API until the attestation is ready.
 * Returns the attestation signature bytes.
 */
async function waitForAttestation(messageHash: string): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < ATTESTATION_MAX_WAIT_MS) {
    try {
      const url = `${CIRCLE_ATTESTATION_API}/attestations/${messageHash}`;
      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json() as { status: string; attestation: string };
        if (data.status === 'complete' && data.attestation && data.attestation !== 'PENDING') {
          console.log(`[BaseGateway] Attestation received for ${messageHash}`);
          return data.attestation;
        }
      }
    } catch (err) {
      console.warn(`[BaseGateway] Attestation poll error for ${messageHash}:`, err);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, ATTESTATION_POLL_INTERVAL_MS));
  }

  throw new Error(`Attestation timeout after ${ATTESTATION_MAX_WAIT_MS / 1000}s for ${messageHash}`);
}

// ──────────────────────────────────────────────
//  DEPOSIT FLOW
// ──────────────────────────────────────────────

/**
 * Process a single deposit end-to-end:
 *   1. Get the Base tx receipt → extract CCTP message
 *   2. Wait for Circle attestation
 *   3. Call receiveMessage on Arbitrum (mints USDC to signer)
 *   4. Approve USDC → call Treasury.deposit() on Arbitrum
 *   5. Call gateway.completeDeposit() on Base
 */
async function processDeposit(deposit: PendingDepositInfo): Promise<void> {
  const nonceKey = deposit.cctpNonce.toString();
  const tag = `[BaseGateway:Deposit:${nonceKey}]`;

  try {
    // Step 1: Get CCTP message from Base tx receipt
    if (!deposit.messageBytes) {
      console.log(`${tag} Fetching CCTP message from tx ${deposit.baseTxHash}`);
      deposit.status = 'bridging';
      deposit.updatedAt = Date.now();

      const baseProvider = getBaseHttpProvider();
      const receipt = await baseProvider.getTransactionReceipt(deposit.baseTxHash);
      if (!receipt) {
        throw new Error(`Transaction receipt not found: ${deposit.baseTxHash}`);
      }

      const parsed = parseCctpMessageFromReceipt(receipt, BASE_MESSAGE_TRANSMITTER);
      if (!parsed) {
        throw new Error(`No CCTP MessageSent event in tx ${deposit.baseTxHash}`);
      }

      deposit.messageBytes = parsed.messageBytes;
      deposit.messageHash = parsed.messageHash;
      deposit.updatedAt = Date.now();
      console.log(`${tag} CCTP message hash: ${parsed.messageHash}`);
    }

    // Step 2: Wait for Circle attestation
    if (!deposit.attestation) {
      console.log(`${tag} Waiting for attestation...`);
      const attestation = await waitForAttestation(deposit.messageHash!);
      deposit.attestation = attestation;
      deposit.status = 'attested';
      deposit.updatedAt = Date.now();
    }

    // Step 3: Call receiveMessage on Arbitrum MessageTransmitter
    if (!deposit.arbReceiveTxHash) {
      console.log(`${tag} Calling receiveMessage on Arbitrum...`);
      deposit.status = 'receiving';
      deposit.updatedAt = Date.now();

      const arbWallet = getArbSignerWallet();
      const arbMessageTransmitter = new ethers.Contract(
        ARB_MESSAGE_TRANSMITTER,
        MESSAGE_TRANSMITTER_ABI,
        arbWallet
      );

      const receiveTx = await arbMessageTransmitter.receiveMessage(
        deposit.messageBytes!,
        deposit.attestation!
      );
      const receiveReceipt = await receiveTx.wait();
      deposit.arbReceiveTxHash = receiveReceipt.hash;
      deposit.updatedAt = Date.now();
      console.log(`${tag} USDC minted on Arbitrum: ${receiveReceipt.hash}`);
    }

    // Step 4: Approve USDC + call Treasury.deposit() on Arbitrum
    if (!deposit.arbDepositTxHash) {
      console.log(`${tag} Depositing ${ethers.formatUnits(deposit.usdcAmount, 6)} USDC into Treasury...`);
      deposit.status = 'executing';
      deposit.updatedAt = Date.now();

      const arbWallet = getArbSignerWallet();
      const treasuryAddress = config.contracts.treasury!;
      const signerAddress = getSignerWallet().address;

      // Approve USDC to Treasury
      const arbUsdc = new ethers.Contract(ARB_USDC, ERC20_ABI, arbWallet);
      const approveTx = await arbUsdc.approve(treasuryAddress, deposit.usdcAmount);
      await approveTx.wait();
      console.log(`${tag} USDC approved to Treasury`);

      // Sign approval using existing signer service
      // The signer signs on behalf of the gateway's signer address (which holds the USDC)
      const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
      const signature = await signApproval(signerAddress, 'deposit', expiry);

      // Call Treasury.deposit()
      const treasury = new ethers.Contract(treasuryAddress, TREASURY_ABI, arbWallet);
      const depositTx = await treasury.deposit(deposit.usdcAmount, expiry, signature);
      const depositReceipt = await depositTx.wait();
      deposit.arbDepositTxHash = depositReceipt.hash;
      deposit.updatedAt = Date.now();
      console.log(`${tag} Treasury deposit tx: ${depositReceipt.hash}`);

      // Read how much ROSE was minted (from Deposited event or calculate)
      const roseAmount = await treasury.calculateRoseForDeposit(deposit.usdcAmount);
      deposit.roseAmount = roseAmount;
      console.log(`${tag} ROSE minted: ${ethers.formatUnits(roseAmount, 18)}`);
    }

    // Step 5: Call gateway.completeDeposit() on Base
    if (!deposit.baseCompleteTxHash) {
      console.log(`${tag} Completing deposit on Base Gateway...`);
      deposit.status = 'completing';
      deposit.updatedAt = Date.now();

      const baseWallet = getBaseSignerWallet();
      const gateway = new ethers.Contract(BASE_GATEWAY_ADDRESS, GATEWAY_ABI, baseWallet);

      const completeTx = await gateway.completeDeposit(deposit.cctpNonce, deposit.roseAmount!);
      const completeReceipt = await completeTx.wait();
      deposit.baseCompleteTxHash = completeReceipt.hash;
      deposit.status = 'completed';
      deposit.updatedAt = Date.now();

      stats.depositsCompleted++;
      console.log(
        `${tag} ✅ Deposit complete! Agent ${deposit.agent} received ` +
        `${ethers.formatUnits(deposit.roseAmount!, 18)} ROSE. Complete tx: ${completeReceipt.hash}`
      );
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    deposit.status = 'failed';
    deposit.error = errorMsg;
    deposit.updatedAt = Date.now();
    stats.depositsFailed++;
    stats.lastError = errorMsg;
    console.error(`${tag} ❌ Failed:`, errorMsg);
  }
}

// ──────────────────────────────────────────────
//  REDEEM FLOW
// ──────────────────────────────────────────────

/**
 * Process a single redemption end-to-end:
 *   1. Call Treasury.redeem() on Arbitrum (burns ROSE, receives USDC)
 *   2. Bridge USDC back to Base via CCTP
 *   3. Wait for attestation + call receiveMessage on Base
 *   4. Call gateway.completeRedeem() on Base
 */
async function processRedeem(redeem: PendingRedeemInfo): Promise<void> {
  const redeemKey = redeem.redeemId.toString();
  const tag = `[BaseGateway:Redeem:${redeemKey}]`;

  try {
    // Step 1: Call Treasury.redeem() on Arbitrum
    if (!redeem.arbRedeemTxHash) {
      console.log(`${tag} Redeeming ${ethers.formatUnits(redeem.roseAmount, 18)} ROSE on Arbitrum Treasury...`);
      redeem.status = 'executing';
      redeem.updatedAt = Date.now();

      const arbWallet = getArbSignerWallet();
      const treasuryAddress = config.contracts.treasury!;
      const signerAddress = getSignerWallet().address;

      // Calculate USDC we'll receive
      const treasury = new ethers.Contract(treasuryAddress, TREASURY_ABI, arbWallet);
      const usdcAmount = await treasury.calculateUsdcForRedemption(redeem.roseAmount);
      redeem.usdcAmount = usdcAmount;

      // The signer needs ROSE tokens to redeem. In the gateway flow, the signer
      // doesn't hold ROSE — the Treasury minted ROSE to the signer's address during deposit.
      // For redemption of virtual balances, the signer acts as an intermediary.
      // The gateway already debited the agent's virtual balance — signer needs
      // to have enough ROSE from previous deposits to cover this.

      // Get ROSE token address from Treasury
      const roseTokenAddress = await treasury.roseToken();

      // Approve ROSE to Treasury
      const roseToken = new ethers.Contract(roseTokenAddress, ERC20_ABI, arbWallet);
      const roseApproveTx = await roseToken.approve(treasuryAddress, redeem.roseAmount);
      await roseApproveTx.wait();
      console.log(`${tag} ROSE approved to Treasury`);

      // Sign approval
      const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
      const signature = await signApproval(signerAddress, 'redeem', expiry);

      // Call Treasury.redeem()
      const redeemTx = await treasury.redeem(redeem.roseAmount, expiry, signature);
      const redeemReceipt = await redeemTx.wait();
      redeem.arbRedeemTxHash = redeemReceipt.hash;
      redeem.updatedAt = Date.now();
      console.log(`${tag} Treasury redeem tx: ${redeemReceipt.hash}, USDC: ${ethers.formatUnits(usdcAmount, 6)}`);
    }

    // Step 2: Bridge USDC from Arbitrum → Base via CCTP
    if (!redeem.cctpNonce) {
      console.log(`${tag} Bridging ${ethers.formatUnits(redeem.usdcAmount!, 6)} USDC from Arbitrum → Base via CCTP...`);
      redeem.status = 'bridging';
      redeem.updatedAt = Date.now();

      const arbWallet = getArbSignerWallet();

      // Approve USDC to Arbitrum TokenMessenger
      const arbUsdc = new ethers.Contract(ARB_USDC, ERC20_ABI, arbWallet);
      const approveTx = await arbUsdc.approve(ARB_TOKEN_MESSENGER, redeem.usdcAmount!);
      await approveTx.wait();

      // Call depositForBurn — USDC → Base, recipient = Base Gateway contract
      const arbTokenMessenger = new ethers.Contract(
        ARB_TOKEN_MESSENGER,
        TOKEN_MESSENGER_ABI,
        arbWallet
      );
      const gatewayBytes32 = ethers.zeroPadValue(BASE_GATEWAY_ADDRESS, 32);

      const burnTx = await arbTokenMessenger.depositForBurn(
        redeem.usdcAmount!,
        BASE_DOMAIN,
        gatewayBytes32,
        ARB_USDC
      );
      const burnReceipt = await burnTx.wait();

      // Parse CCTP message
      const parsed = parseCctpMessageFromReceipt(burnReceipt, ARB_MESSAGE_TRANSMITTER);
      if (!parsed) {
        throw new Error(`No CCTP MessageSent event in burn tx ${burnReceipt.hash}`);
      }

      // Extract nonce from receipt logs (TokenMessenger emits DepositForBurn with nonce)
      // For tracking, use the message hash
      redeem.messageBytes = parsed.messageBytes;
      redeem.messageHash = parsed.messageHash;
      redeem.updatedAt = Date.now();
      console.log(`${tag} CCTP burn tx: ${burnReceipt.hash}, message hash: ${parsed.messageHash}`);
    }

    // Step 3: Wait for Circle attestation
    if (!redeem.attestation) {
      console.log(`${tag} Waiting for attestation...`);
      const attestation = await waitForAttestation(redeem.messageHash!);
      redeem.attestation = attestation;
      redeem.status = 'attested';
      redeem.updatedAt = Date.now();
    }

    // Step 4: Call receiveMessage on Base MessageTransmitter
    if (!redeem.baseReceiveTxHash) {
      console.log(`${tag} Calling receiveMessage on Base...`);
      redeem.status = 'receiving';
      redeem.updatedAt = Date.now();

      const baseWallet = getBaseSignerWallet();
      const baseMessageTransmitter = new ethers.Contract(
        BASE_MESSAGE_TRANSMITTER,
        MESSAGE_TRANSMITTER_ABI,
        baseWallet
      );

      const receiveTx = await baseMessageTransmitter.receiveMessage(
        redeem.messageBytes!,
        redeem.attestation!
      );
      const receiveReceipt = await receiveTx.wait();
      redeem.baseReceiveTxHash = receiveReceipt.hash;
      redeem.updatedAt = Date.now();
      console.log(`${tag} USDC minted on Base (to gateway): ${receiveReceipt.hash}`);
    }

    // Step 5: Call gateway.completeRedeem() on Base
    if (!redeem.baseCompleteTxHash) {
      console.log(`${tag} Completing redeem on Base Gateway...`);
      redeem.status = 'completing';
      redeem.updatedAt = Date.now();

      const baseWallet = getBaseSignerWallet();
      const gateway = new ethers.Contract(BASE_GATEWAY_ADDRESS, GATEWAY_ABI, baseWallet);

      const completeTx = await gateway.completeRedeem(redeem.redeemId, redeem.usdcAmount!);
      const completeReceipt = await completeTx.wait();
      redeem.baseCompleteTxHash = completeReceipt.hash;
      redeem.status = 'completed';
      redeem.updatedAt = Date.now();

      stats.redeemsCompleted++;
      console.log(
        `${tag} ✅ Redeem complete! Agent ${redeem.agent} received ` +
        `${ethers.formatUnits(redeem.usdcAmount!, 6)} USDC. Complete tx: ${completeReceipt.hash}`
      );
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    redeem.status = 'failed';
    redeem.error = errorMsg;
    redeem.updatedAt = Date.now();
    stats.redeemsFailed++;
    stats.lastError = errorMsg;
    console.error(`${tag} ❌ Failed:`, errorMsg);

    // Try to cancel the redeem on Base so agent gets their virtual ROSE back
    try {
      if (!redeem.arbRedeemTxHash) {
        // Haven't touched Arbitrum yet — safe to cancel
        console.log(`${tag} Cancelling redeem on Base Gateway...`);
        const baseWallet = getBaseSignerWallet();
        const gateway = new ethers.Contract(BASE_GATEWAY_ADDRESS, GATEWAY_ABI, baseWallet);
        const cancelTx = await gateway.cancelRedeem(redeem.redeemId);
        await cancelTx.wait();
        console.log(`${tag} Redeem cancelled on Base Gateway`);
      }
    } catch (cancelErr) {
      console.error(`${tag} Failed to cancel redeem:`, cancelErr);
    }
  }
}

// ──────────────────────────────────────────────
//  Event Handlers
// ──────────────────────────────────────────────

// Processing lock to prevent concurrent processing
let isProcessing = false;
const processingQueue: Array<() => Promise<void>> = [];

/**
 * Enqueue and process operations sequentially to avoid nonce conflicts.
 */
async function enqueueTask(task: () => Promise<void>): Promise<void> {
  processingQueue.push(task);
  if (!isProcessing) {
    drainQueue();
  }
}

async function drainQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  while (processingQueue.length > 0) {
    const task = processingQueue.shift()!;
    try {
      await task();
    } catch (err) {
      console.error('[BaseGateway] Task error:', err);
    }
  }

  isProcessing = false;
}

/**
 * Handle DepositInitiated event from Base Gateway.
 */
function handleDepositInitiated(
  agent: string,
  usdcAmount: bigint,
  cctpNonce: bigint,
  event: ethers.EventLog | ethers.Log
): void {
  const nonceKey = cctpNonce.toString();
  console.log(
    `[BaseGateway] DepositInitiated: agent=${agent}, ` +
    `usdc=${ethers.formatUnits(usdcAmount, 6)}, nonce=${nonceKey}`
  );

  // Check if we already tracked this
  if (pendingDeposits.has(nonceKey)) {
    console.log(`[BaseGateway] Deposit nonce ${nonceKey} already tracked, skipping`);
    return;
  }

  stats.depositsDetected++;
  stats.lastEventBlock = 'blockNumber' in event ? event.blockNumber : 0;

  const depositInfo: PendingDepositInfo = {
    cctpNonce,
    agent,
    usdcAmount,
    status: 'pending',
    baseTxHash: event.transactionHash,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };

  pendingDeposits.set(nonceKey, depositInfo);

  // Process asynchronously (sequential queue)
  enqueueTask(() => processDeposit(depositInfo));
}

/**
 * Handle RedeemRequested event from Base Gateway.
 */
function handleRedeemRequested(
  agent: string,
  roseAmount: bigint,
  redeemId: bigint,
  event: ethers.EventLog | ethers.Log
): void {
  const redeemKey = redeemId.toString();
  console.log(
    `[BaseGateway] RedeemRequested: agent=${agent}, ` +
    `rose=${ethers.formatUnits(roseAmount, 18)}, redeemId=${redeemKey}`
  );

  // Check if we already tracked this
  if (pendingRedeems.has(redeemKey)) {
    console.log(`[BaseGateway] Redeem ${redeemKey} already tracked, skipping`);
    return;
  }

  stats.redeemsDetected++;
  stats.lastEventBlock = 'blockNumber' in event ? event.blockNumber : 0;

  const redeemInfo: PendingRedeemInfo = {
    redeemId,
    agent,
    roseAmount,
    status: 'pending',
    baseTxHash: event.transactionHash,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };

  pendingRedeems.set(redeemKey, redeemInfo);

  // Process asynchronously (sequential queue)
  enqueueTask(() => processRedeem(redeemInfo));
}

// ──────────────────────────────────────────────
//  Lifecycle
// ──────────────────────────────────────────────

/**
 * Setup WebSocket event listeners on Base chain.
 */
function setupEventListeners(): void {
  // Clean up previous listeners
  if (gatewayWsContract) {
    gatewayWsContract.removeAllListeners();
  }

  const wsProvider = BASE_WS_URL ? getBaseWsProvider() : null;

  if (!wsProvider) {
    console.log('[BaseGateway] No BASE_WS_URL configured, using polling fallback');
    startPolling();
    return;
  }

  gatewayWsContract = new ethers.Contract(
    BASE_GATEWAY_ADDRESS,
    GATEWAY_ABI,
    wsProvider
  );

  gatewayWsContract.on('DepositInitiated', (agent, usdcAmount, cctpNonce, event) => {
    handleDepositInitiated(agent, usdcAmount, cctpNonce, event);
  });

  gatewayWsContract.on('RedeemRequested', (agent, roseAmount, redeemId, event) => {
    handleRedeemRequested(agent, roseAmount, redeemId, event);
  });

  console.log('[BaseGateway] WebSocket event listeners active');
}

// Polling fallback for when WS is not available
let pollInterval: NodeJS.Timeout | null = null;
let lastPolledBlock = 0;

function startPolling(): void {
  const POLL_INTERVAL = 15000; // 15 seconds

  pollInterval = setInterval(async () => {
    try {
      const provider = getBaseHttpProvider();
      const currentBlock = await provider.getBlockNumber();

      if (lastPolledBlock === 0) {
        lastPolledBlock = currentBlock - STARTUP_BLOCK_LOOKBACK;
      }

      if (currentBlock <= lastPolledBlock) return;

      const gateway = getGatewayContract();

      // Query DepositInitiated events
      const depositFilter = gateway.filters.DepositInitiated();
      const depositEvents = await gateway.queryFilter(depositFilter, lastPolledBlock + 1, currentBlock);

      for (const event of depositEvents) {
        if ('args' in event && event.args) {
          handleDepositInitiated(
            event.args[0], // agent
            event.args[1], // usdcAmount
            event.args[2], // cctpNonce
            event
          );
        }
      }

      // Query RedeemRequested events
      const redeemFilter = gateway.filters.RedeemRequested();
      const redeemEvents = await gateway.queryFilter(redeemFilter, lastPolledBlock + 1, currentBlock);

      for (const event of redeemEvents) {
        if ('args' in event && event.args) {
          handleRedeemRequested(
            event.args[0], // agent
            event.args[1], // roseAmount
            event.args[2], // redeemId
            event
          );
        }
      }

      lastPolledBlock = currentBlock;
    } catch (err) {
      console.error('[BaseGateway] Polling error:', err);
    }
  }, POLL_INTERVAL);
}

/**
 * Start the Base Gateway watcher.
 * Call this from index.ts during server startup.
 */
export async function startBaseGatewayWatcher(): Promise<void> {
  if (!BASE_GATEWAY_ADDRESS) {
    console.log('[BaseGateway] BASE_GATEWAY_ADDRESS not configured, skipping');
    return;
  }

  if (!config.contracts.treasury) {
    console.log('[BaseGateway] TREASURY_ADDRESS not configured, skipping');
    return;
  }

  if (process.env.BASE_GATEWAY_ENABLED === 'false') {
    console.log('[BaseGateway] Disabled via BASE_GATEWAY_ENABLED=false');
    return;
  }

  console.log('[BaseGateway] Starting Base Gateway watcher...');
  console.log(`[BaseGateway] Gateway: ${BASE_GATEWAY_ADDRESS}`);
  console.log(`[BaseGateway] Base RPC: ${BASE_RPC_URL}`);
  console.log(`[BaseGateway] Arb RPC: ${config.rpc.url}`);
  console.log(`[BaseGateway] Signer: ${getSignerWallet().address}`);

  try {
    // Setup event listeners (WS or polling)
    setupEventListeners();

    stats.isRunning = true;
    stats.startedAt = new Date();

    // Catch up on recent events
    if (STARTUP_BLOCK_LOOKBACK > 0) {
      console.log(`[BaseGateway] Catching up on last ${STARTUP_BLOCK_LOOKBACK} blocks...`);
      const provider = getBaseHttpProvider();
      const currentBlock = await provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - STARTUP_BLOCK_LOOKBACK);

      const gateway = getGatewayContract();

      // Catch up deposits
      const depositFilter = gateway.filters.DepositInitiated();
      const depositEvents = await gateway.queryFilter(depositFilter, fromBlock, currentBlock);
      console.log(`[BaseGateway] Found ${depositEvents.length} recent DepositInitiated events`);

      for (const event of depositEvents) {
        if ('args' in event && event.args) {
          // Check if already completed on-chain
          const nonce = event.args[2] as bigint;
          const [, , completed] = await gateway.pendingDeposits(nonce);
          if (!completed) {
            handleDepositInitiated(event.args[0], event.args[1], event.args[2], event);
          } else {
            console.log(`[BaseGateway] Skipping completed deposit nonce=${nonce}`);
          }
        }
      }

      // Catch up redeems
      const redeemFilter = gateway.filters.RedeemRequested();
      const redeemEvents = await gateway.queryFilter(redeemFilter, fromBlock, currentBlock);
      console.log(`[BaseGateway] Found ${redeemEvents.length} recent RedeemRequested events`);

      for (const event of redeemEvents) {
        if ('args' in event && event.args) {
          const redeemId = event.args[2] as bigint;
          const [, , completed] = await gateway.pendingRedeems(redeemId);
          if (!completed) {
            handleRedeemRequested(event.args[0], event.args[1], event.args[2], event);
          } else {
            console.log(`[BaseGateway] Skipping completed redeem id=${redeemId}`);
          }
        }
      }
    }

    console.log('[BaseGateway] Watcher started successfully');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error('[BaseGateway] Failed to start:', error);
    throw error;
  }
}

/**
 * Stop the Base Gateway watcher.
 */
export function stopBaseGatewayWatcher(): void {
  if (gatewayWsContract) {
    gatewayWsContract.removeAllListeners();
    gatewayWsContract = null;
  }
  if (baseWsProvider) {
    baseWsProvider.destroy();
    baseWsProvider = null;
  }
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  stats.isRunning = false;
  console.log('[BaseGateway] Stopped');
}

// ──────────────────────────────────────────────
//  Exports (for routes)
// ──────────────────────────────────────────────

export function getBaseGatewayStats(): BaseGatewayStats & {
  pendingDeposits: number;
  pendingRedeems: number;
} {
  return {
    ...stats,
    pendingDeposits: pendingDeposits.size,
    pendingRedeems: pendingRedeems.size,
  };
}

export function getPendingDepositByNonce(nonce: string): PendingDepositInfo | undefined {
  return pendingDeposits.get(nonce);
}

export function getPendingRedeemById(redeemId: string): PendingRedeemInfo | undefined {
  return pendingRedeems.get(redeemId);
}

export function getAllPendingDeposits(): PendingDepositInfo[] {
  return Array.from(pendingDeposits.values());
}

export function getAllPendingRedeems(): PendingRedeemInfo[] {
  return Array.from(pendingRedeems.values());
}

/**
 * Find a deposit by its Base chain transaction hash.
 */
export function getDepositByBaseTxHash(txHash: string): PendingDepositInfo | undefined {
  const lower = txHash.toLowerCase();
  for (const deposit of pendingDeposits.values()) {
    if (deposit.baseTxHash.toLowerCase() === lower) {
      return deposit;
    }
  }
  return undefined;
}

/**
 * Find a redeem by its Base chain transaction hash.
 */
export function getRedeemByBaseTxHash(txHash: string): PendingRedeemInfo | undefined {
  const lower = txHash.toLowerCase();
  for (const redeem of pendingRedeems.values()) {
    if (redeem.baseTxHash.toLowerCase() === lower) {
      return redeem;
    }
  }
  return undefined;
}

/**
 * Retry a failed deposit.
 */
export async function retryDeposit(nonce: string): Promise<boolean> {
  const deposit = pendingDeposits.get(nonce);
  if (!deposit || deposit.status !== 'failed') return false;

  deposit.status = 'pending';
  deposit.error = undefined;
  deposit.updatedAt = Date.now();

  enqueueTask(() => processDeposit(deposit));
  return true;
}

/**
 * Retry a failed redeem.
 */
export async function retryRedeem(redeemId: string): Promise<boolean> {
  const redeem = pendingRedeems.get(redeemId);
  if (!redeem || redeem.status !== 'failed') return false;

  redeem.status = 'pending';
  redeem.error = undefined;
  redeem.updatedAt = Date.now();

  enqueueTask(() => processRedeem(redeem));
  return true;
}
