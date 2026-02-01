/**
 * XMTP Messaging Service
 *
 * Provides agent-to-agent messaging via the XMTP protocol.
 * Used for:
 *   - Bug report notifications
 *   - Task lifecycle notifications (new bids, approvals, disputes)
 *   - Agent-to-agent communication
 *
 * The service initializes an XMTP client using the signer's wallet key
 * and provides methods to send DMs and check reachability.
 *
 * Requires:
 *   - XMTP is enabled by default (set XMTP_ENABLED=false to disable)
 *   - The signer wallet private key (reused from config.signer.privateKey)
 *   - XMTP_DB_ENCRYPTION_KEY in env (32 bytes hex) — or auto-generated on first run
 */

import { getRandomValues } from 'node:crypto';
import { ethers } from 'ethers';
import { config } from '../config';

// Lazy-loaded XMTP SDK — native bindings may not be available on all platforms
let xmtpSdk: typeof import('@xmtp/node-sdk') | null = null;

async function loadXmtpSdk() {
  if (!xmtpSdk) {
    xmtpSdk = await import('@xmtp/node-sdk');
  }
  return xmtpSdk;
}

// ============================================================
// Types
// ============================================================

export interface XmtpSendResult {
  success: boolean;
  conversationId?: string;
  messageId?: string;
  error?: string;
}

export interface XmtpReachabilityResult {
  address: string;
  reachable: boolean;
  inboxId?: string;
}

// ============================================================
// State
// ============================================================

let xmtpClient: any = null;
let isInitializing = false;
let initError: string | null = null;

// ============================================================
// Initialization
// ============================================================

/**
 * Create an XMTP Signer from the signer's Ethereum private key.
 */
function createXmtpSigner(privateKey: string, sdk: typeof import('@xmtp/node-sdk')) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;

  return {
    type: 'EOA' as const,
    getIdentifier: () => ({
      identifier: address,
      identifierKind: sdk.IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string): Promise<Uint8Array> => {
      const sig = await wallet.signMessage(message);
      return ethers.getBytes(sig);
    },
  };
}

/**
 * Get or generate the DB encryption key.
 * Uses XMTP_DB_ENCRYPTION_KEY env var if set, otherwise generates a random one.
 * The key persists across restarts if stored in env.
 */
function getDbEncryptionKey(): Uint8Array {
  const envKey = process.env.XMTP_DB_ENCRYPTION_KEY;
  if (envKey) {
    return ethers.getBytes(envKey);
  }
  // Generate random key — note: this means DB is ephemeral across restarts
  // unless the env var is set
  console.log('[XMTP] No XMTP_DB_ENCRYPTION_KEY set, generating ephemeral key');
  return getRandomValues(new Uint8Array(32));
}

/**
 * Initialize the XMTP client. Called once at startup if XMTP_ENABLED=true.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initXmtp(): Promise<void> {
  if (xmtpClient || isInitializing) return;

  if (process.env.XMTP_ENABLED === 'false') {
    console.log('[XMTP] Disabled (XMTP_ENABLED=false)');
    return;
  }

  isInitializing = true;

  try {
    console.log('[XMTP] Initializing client...');

    const sdk = await loadXmtpSdk();
    const signer = createXmtpSigner(config.signer.privateKey, sdk);
    const dbEncryptionKey = getDbEncryptionKey();

    xmtpClient = await sdk.Client.create(signer, { dbEncryptionKey });

    console.log(`[XMTP] Client ready — inbox: ${xmtpClient.inboxId}`);
    initError = null;
  } catch (error: any) {
    console.error('[XMTP] Failed to initialize:', error.message);
    initError = error.message;
    xmtpClient = null;
  } finally {
    isInitializing = false;
  }
}

/**
 * Get the XMTP client instance. Returns null if not initialized or disabled.
 */
export function getXmtpClient(): any {
  return xmtpClient;
}

/**
 * Check if XMTP is ready to send messages.
 */
export function isXmtpReady(): boolean {
  return xmtpClient !== null;
}

/**
 * Get XMTP service status.
 */
export function getXmtpStatus(): { enabled: boolean; ready: boolean; error: string | null; inboxId?: string } {
  return {
    enabled: process.env.XMTP_ENABLED !== 'false',
    ready: xmtpClient !== null,
    error: initError,
    inboxId: xmtpClient?.inboxId,
  };
}

// ============================================================
// Messaging
// ============================================================

/**
 * Send a DM to an Ethereum address via XMTP.
 * Creates a new conversation (or reuses existing) and sends the message.
 *
 * @param toAddress - Recipient's Ethereum address
 * @param message - Text message to send
 * @returns Result with success status and conversation/message IDs
 */
export async function sendDm(toAddress: string, message: string): Promise<XmtpSendResult> {
  if (!xmtpClient) {
    return { success: false, error: 'XMTP client not initialized' };
  }

  if (!ethers.isAddress(toAddress)) {
    return { success: false, error: 'Invalid Ethereum address' };
  }

  try {
    const sdk = await loadXmtpSdk();

    // Check if recipient is reachable on XMTP
    const canMessage = await xmtpClient.canMessage([
      { identifier: toAddress, identifierKind: sdk.IdentifierKind.Ethereum },
    ]);

    if (!canMessage.get(toAddress.toLowerCase())) {
      return {
        success: false,
        error: `Address ${toAddress} is not reachable on XMTP (no XMTP identity registered)`,
      };
    }

    // Resolve address → inbox ID, then create or get existing DM conversation
    const identifier = { identifier: toAddress, identifierKind: sdk.IdentifierKind.Ethereum };
    const inboxId = await sdk.getInboxIdForIdentifier(identifier);
    if (!inboxId) {
      return {
        success: false,
        error: `Could not resolve inbox ID for ${toAddress}`,
      };
    }
    const conversation = await xmtpClient.conversations.createDm(inboxId);

    // Send the message
    const messageId = await conversation.sendText(message);

    console.log(`[XMTP] DM sent to ${toAddress}: ${message.substring(0, 50)}...`);

    return {
      success: true,
      conversationId: conversation.id,
      messageId: messageId?.toString(),
    };
  } catch (error: any) {
    console.error(`[XMTP] Failed to send DM to ${toAddress}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send a notification to an agent using their registered contact methods.
 * Tries XMTP first (if agent has xmtp: true in contactMethods).
 *
 * @param agentAddress - Agent's wallet address
 * @param subject - Notification subject/type
 * @param body - Notification body text
 */
export async function notifyAgent(
  agentAddress: string,
  subject: string,
  body: string
): Promise<XmtpSendResult> {
  const fullMessage = `[Rose Token] ${subject}\n\n${body}`;
  return sendDm(agentAddress, fullMessage);
}

/**
 * Check if one or more addresses are reachable on XMTP.
 */
export async function checkReachability(addresses: string[]): Promise<XmtpReachabilityResult[]> {
  if (!xmtpClient) {
    return addresses.map((addr) => ({ address: addr, reachable: false }));
  }

  try {
    const sdk = await loadXmtpSdk();
    const identifiers = addresses.map((addr) => ({
      identifier: addr,
      identifierKind: sdk.IdentifierKind.Ethereum,
    }));

    const canMessageMap = await xmtpClient.canMessage(identifiers);

    return addresses.map((addr) => ({
      address: addr,
      reachable: canMessageMap.get(addr.toLowerCase()) ?? false,
    }));
  } catch (error: any) {
    console.error('[XMTP] Reachability check failed:', error.message);
    return addresses.map((addr) => ({ address: addr, reachable: false }));
  }
}

// ============================================================
// Inbox / Message Retrieval
// ============================================================

export interface XmtpConversationSummary {
  conversationId: string;
  peerAddress: string;
  peerInboxId: string;
  lastMessage?: {
    id: string;
    content: string;
    senderInboxId: string;
    sentAt: string;
  };
}

export interface XmtpInboxMessage {
  id: string;
  conversationId: string;
  senderInboxId: string;
  content: unknown;
  contentType: string;
  sentAt: string;
}

/**
 * List all DM conversations with their last message.
 * Syncs from network first to get latest state.
 */
export async function listConversations(): Promise<XmtpConversationSummary[]> {
  if (!xmtpClient) {
    return [];
  }

  try {
    // Sync latest from network
    await xmtpClient.conversations.sync();

    const dms = xmtpClient.conversations.listDms();
    const results: XmtpConversationSummary[] = [];

    for (const dm of dms) {
      await dm.sync();
      const last = await dm.lastMessage();
      const members = await dm.members();
      const peer = members.find((m: any) => m.inboxId !== xmtpClient!.inboxId);

      results.push({
        conversationId: dm.id,
        peerAddress: peer?.accountIdentifiers?.[0]?.identifier ?? 'unknown',
        peerInboxId: peer?.inboxId ?? 'unknown',
        lastMessage: last
          ? {
              id: last.id,
              content: typeof last.content === 'string' ? last.content : JSON.stringify(last.content),
              senderInboxId: last.senderInboxId,
              sentAt: last.sentAt.toISOString(),
            }
          : undefined,
      });
    }

    return results;
  } catch (error: any) {
    console.error('[XMTP] Failed to list conversations:', error.message);
    return [];
  }
}

/**
 * Get messages from a specific conversation.
 * @param conversationId - The conversation ID
 * @param limit - Max messages to return (default 50)
 * @param afterNs - Only return messages after this timestamp (nanoseconds)
 */
export async function getMessages(
  conversationId: string,
  limit = 50,
  afterNs?: bigint
): Promise<XmtpInboxMessage[]> {
  if (!xmtpClient) {
    return [];
  }

  try {
    const conversation = await xmtpClient.conversations.getConversationById(conversationId);
    if (!conversation) {
      return [];
    }

    await conversation.sync();

    const options: any = { limit };
    if (afterNs) {
      options.sentAfterNs = afterNs;
    }

    const messages = await conversation.messages(options);

    return messages
      .filter((m: any) => String(m.kind) === '1') // application messages only (not membership changes)
      .map((m: any) => ({
        id: m.id,
        conversationId: m.conversationId,
        senderInboxId: m.senderInboxId,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        contentType: m.contentType
          ? `${m.contentType.authorityId}/${m.contentType.typeId}`
          : 'unknown',
        sentAt: m.sentAt.toISOString(),
      }));
  } catch (error: any) {
    console.error(`[XMTP] Failed to get messages for ${conversationId}:`, error.message);
    return [];
  }
}

// ============================================================
// Task Notification Helpers
// ============================================================

/**
 * Notify a worker that their bid was accepted.
 */
export async function notifyBidAccepted(
  workerAddress: string,
  taskId: number,
  taskTitle: string,
  bidAmount: string
): Promise<XmtpSendResult> {
  return notifyAgent(
    workerAddress,
    `🎉 Your bid was accepted on task #${taskId}`,
    `Task: "${taskTitle}"\nYour bid: ${ethers.formatUnits(BigInt(bidAmount), 18)} ROSE\n\nThe customer selected your bid. You can now claim the task and start working.\n\nView task: https://app.rose-token.com/tasks/${taskId}`
  );
}

/**
 * Notify a customer that a new bid was submitted on their auction.
 */
export async function notifyNewBid(
  customerAddress: string,
  taskId: number,
  taskTitle: string,
  bidCount: number
): Promise<XmtpSendResult> {
  return notifyAgent(
    customerAddress,
    `📩 New bid on task #${taskId}`,
    `Task: "${taskTitle}"\nTotal bids: ${bidCount}\n\nReview bids: GET /api/agent/marketplace/tasks/${taskId}/bids`
  );
}

/**
 * Notify relevant parties about task completion.
 */
export async function notifyTaskCompleted(
  customerAddress: string,
  stakeholderAddress: string | null,
  taskId: number,
  taskTitle: string,
  prUrl: string
): Promise<void> {
  const body = `Task: "${taskTitle}"\nPR/Deliverable: ${prUrl}\n\nPlease review and approve the work.\n\nApprove: POST /api/agent/marketplace/tasks/${taskId}/approve`;

  await notifyAgent(customerAddress, `✅ Task #${taskId} marked complete`, body);

  if (stakeholderAddress && stakeholderAddress !== ethers.ZeroAddress) {
    await notifyAgent(stakeholderAddress, `✅ Task #${taskId} marked complete — review needed`, body);
  }
}

/**
 * Notify a worker that their work was approved and payment is ready.
 */
export async function notifyPaymentReady(
  workerAddress: string,
  taskId: number,
  taskTitle: string,
  payoutFormatted: string
): Promise<XmtpSendResult> {
  return notifyAgent(
    workerAddress,
    `💰 Payment ready for task #${taskId}`,
    `Task: "${taskTitle}"\nPayout: ${payoutFormatted} ROSE (95%)\n\nCollect payment: POST /api/agent/marketplace/tasks/${taskId}/accept-payment`
  );
}

/**
 * Notify about a dispute raised on a task.
 */
export async function notifyDispute(
  recipientAddress: string,
  taskId: number,
  taskTitle: string,
  disputeRole: string,
  reasonHash: string
): Promise<XmtpSendResult> {
  return notifyAgent(
    recipientAddress,
    `⚠️ Dispute raised on task #${taskId}`,
    `Task: "${taskTitle}"\nDisputed by: ${disputeRole}\nReason: ${reasonHash}\n\nView task: https://app.rose-token.com/tasks/${taskId}`
  );
}
