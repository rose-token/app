export type Action = 'createTask' | 'stake' | 'claim' | 'propose';

export interface PassportScore {
  address: string;
  score: string;
  status: 'DONE' | 'PROCESSING' | 'ERROR';
  last_score_timestamp: string;
  evidence?: object;
  error?: string;
}

export interface VerifyRequest {
  address: string;
  action: Action;
}

export interface VerifyResponse {
  address: string;
  action: Action;
  score: number;
  threshold: number;
  expiry: number;
  signature: string;
}

export interface ErrorResponse {
  error: string;
  score?: number;
  threshold?: number;
}

export interface ScoreResponse {
  address: string;
  score: number;
  thresholds: {
    createTask: number;
    stake: number;
    claim: number;
    propose: number;
  };
}

export interface SignerResponse {
  signer: string;
}

export interface ThresholdsResponse {
  createTask: number;
  stake: number;
  claim: number;
  propose: number;
}

// Profile types
export interface ProfileMessage {
  address: string;
  name: string;
  bio: string;
  avatar: string;
  skills: string; // JSON.stringify(skills[])
  github: string;
  twitter: string;
  website: string;
  timestamp: number;
}

export interface ProfileRequest {
  message: ProfileMessage;
  signature: string;
}

export interface ProfileData {
  address: string;
  name: string;
  bio: string | null;
  avatar: string | null;
  skills: string[];
  github: string | null;
  twitter: string | null;
  website: string | null;
  signature: string;
  signedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileResponse {
  success: boolean;
  profile: ProfileData;
}

export interface ProfilesResponse {
  profiles: Record<string, ProfileData | null>;
}

export interface ProfileErrorResponse {
  error: string;
  invalid?: string[];
  details?: Record<string, string>;
}

// Delegation vote types
export interface DelegationAllocation {
  delegator: string;
  powerUsed: string; // BigInt as string
}

export interface DelegationVoteRequest {
  delegate: string;
  proposalId: number;
  amount: string; // BigInt as string
  support: boolean;
}

export interface DelegationVoteResponse {
  delegate: string;
  proposalId: number;
  amount: string;
  support: boolean;
  allocationsHash: string;
  allocations: DelegationAllocation[];
  expiry: number;
  signature: string;
}

export interface DelegationErrorResponse {
  error: string;
  availablePower?: string;
  requestedAmount?: string;
}

// Claim types (must match contract's ClaimType enum)
export enum ClaimType {
  DirectVoter = 0,
  Delegator = 1,
}

export interface ClaimData {
  proposalId: number;
  claimType: ClaimType;
  delegate: string;    // ZeroAddress for direct voters
  votePower: string;   // BigInt as string
}

export interface ClaimableRewardsRequest {
  user: string;
}

export interface ClaimableRewardsResponse {
  user: string;
  claims: ClaimData[];
  totalClaimable: string;  // Estimated total in ROSE wei
  expiry: number;
  signature: string;
}

export interface ClaimableRewardsDisplayResponse {
  user: string;
  claims: ClaimData[];
  totalClaimable: string;
}

export interface ClaimErrorResponse {
  error: string;
}

// Governance VP types
export interface VPDataResponse {
  stakedRose: string;
  votingPower: string;
  availableVP: string;
  delegatedOut: string;
  proposalVPLocked: string;
  activeProposal: number;
}

export interface TotalVPResponse {
  totalVP: string;
}

export interface DelegationsResponse {
  delegations: Array<{
    delegate: string;
    vpAmount: string;
  }>;
}

export interface ReceivedDelegationsResponse {
  delegators: Array<{
    delegator: string;
    vpAmount: string;
  }>;
}

export interface VoteSignatureRequest {
  voter: string;
  proposalId: number;
  vpAmount: string;
  support: boolean;
}

export interface VoteSignatureResponse {
  voter: string;
  proposalId: number;
  vpAmount: string;
  support: boolean;
  expiry: number;
  signature: string;
}

export interface RefreshVPRequest {
  user: string;
}

export interface RefreshVPResponse {
  user: string;
  newRep: number;
  expiry: number;
  signature: string;
}

// Phase 1: Vote reduction types
export interface VoteReduction {
  proposalId: number;
  delegate: string;
  vpToRemove: string;  // BigInt as string
  support: boolean;
}

export interface UndelegateWithReductionRequest {
  delegator: string;
  delegate: string;
  vpAmount: string;  // BigInt as string
}

export interface UndelegateWithReductionResponse {
  delegator: string;
  delegate: string;
  vpAmount: string;
  reductions: VoteReduction[];
  expiry: number;
  signature: string;
}

// Phase 1: Updated delegation vote response to include nonce
export interface DelegationVoteResponseV2 {
  delegate: string;
  proposalId: number;
  amount: string;
  support: boolean;
  allocationsHash: string;
  allocations: DelegationAllocation[];
  nonce: string;  // BigInt as string
  expiry: number;
  signature: string;
}

// Phase 2: Confirm undelegate request (clears DB allocations)
export interface ConfirmUndelegateRequest {
  delegator: string;
  delegate: string;
  proposalIds: number[];
}

export interface ConfirmUndelegateResponse {
  success: boolean;
  cleared: number;
}

// Phase 2: Reconciliation types
export interface ReconciliationStatus {
  lastReconciliation: string | null;
  isHealthy: boolean | null;
  discrepancyCount: number;
  stats: {
    totalDbRecords: number;
    uniqueProposals: number;
    uniqueDelegates: number;
    uniqueDelegators: number;
  };
}

// Phase 3: Delegate scoring types
export interface DelegateScoreResponse {
  delegate: string;
  hasScore: boolean;
  totalDelegatedVotes?: number;
  winningVotes?: number;
  missedVotes?: number;
  winRate?: number;
  winRatePercent?: string;
  participationRate?: number;
  participationRatePercent?: string;
  createdAt?: string;
  updatedAt?: string;
  message?: string;
}

export interface DelegateEligibilityResponse {
  delegate: string;
  eligible: boolean;
  reason: string | null;
  gateEnabled: boolean;
  minVotesRequired: number;
  minWinRate: number;
  score: {
    totalDelegatedVotes: number;
    winningVotes: number;
    winRate: number;
  } | null;
}

export interface DelegateLeaderboardEntry {
  rank: number;
  delegate: string;
  totalDelegatedVotes: number;
  winningVotes: number;
  winRate: number;
  winRatePercent: string;
  participationRate: number;
  updatedAt: string;
}

export interface DelegateLeaderboardResponse {
  delegates: DelegateLeaderboardEntry[];
  total: number;
  minVotesForRanking: number;
}

export interface DelegateScoringStatsResponse {
  totalDelegatesScored: number;
  totalProposalsScored: number;
  averageWinRate: number;
  averageWinRatePercent: string;
  topDelegate: {
    address: string;
    winRate: number;
    totalVotes: number;
  } | null;
  config: {
    enabled: boolean;
    gateOnScore: boolean;
    minVotesForWinRate: number;
    minWinRate: number;
  };
}

// Phase 4: VP Refresh types
export interface VPRefreshStatsResponse {
  enabled: boolean;
  executeOnChain: boolean;
  isRunning: boolean;
  startedAt: string | null;
  eventsProcessed: number;
  usersQueued: number;
  refreshesExecuted: number;
  refreshesSkipped: number;
  lastError: string | null;
  lastEventBlock: number;
  pendingUsers: string[];
  config: {
    minVpDifference: string;
    debounceMs: number;
    maxBatchSize: number;
    startupBlockLookback: number;
  };
}

export interface VPRefreshResultResponse {
  address: string;
  success: boolean;
  txHash?: string;
  error?: string;
  oldVP: string;
  newVP: string;
  oldRep: number;
  newRep: number;
}

export interface VPRefreshCheckResponse {
  address: string;
  needsRefresh: boolean;
  message?: string;
  result?: VPRefreshResultResponse;
}

export interface VPRefreshProcessResponse {
  processed: number;
  results: VPRefreshResultResponse[];
}

export interface VPRefreshConfigResponse {
  enabled: boolean;
  executeOnChain: boolean;
  minVpDifference: string;
  debounceMs: number;
  maxBatchSize: number;
  startupBlockLookback: number;
  contracts: {
    governance: string;
    marketplace: string;
  };
}

// ==========================================
// Auction Types (Reverse Auction System)
// ==========================================

// Database row types
export interface AuctionTaskRow {
  task_id: number;
  max_budget: string; // NUMERIC comes as string from pg
  bid_count: number;
  winner_address: string | null;
  winning_bid: string | null;
  concluded_at: string | null;
  created_at: string;
}

export interface AuctionBidRow {
  id: number;
  task_id: number;
  worker_address: string;
  bid_amount: string; // NUMERIC comes as string from pg
  message: string | null;
  created_at: string;
  updated_at: string;
}

// API request/response types
export interface RegisterAuctionTaskRequest {
  taskId: number;
  maxBudget: string; // BigInt as string
}

export interface RegisterAuctionTaskResponse {
  success: boolean;
  taskId: number;
  maxBudget: string;
}

export interface SubmitBidRequest {
  taskId: number;
  worker: string;
  bidAmount: string; // BigInt as string
  message?: string;
  signature: string; // Worker signature proving ownership
}

export interface SubmitBidResponse {
  success: boolean;
  taskId: number;
  worker: string;
  bidAmount: string;
  isUpdate: boolean; // true if this updated an existing bid
}

export interface AuctionBid {
  taskId: number;
  worker: string;
  bidAmount: string;
  displayBid: string; // Midpoint between maxBudget and bidAmount - shown to customer
  message: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GetBidsResponse {
  taskId: number;
  maxBudget: string;
  bidCount: number;
  bids: AuctionBid[];
}

export interface GetBidCountResponse {
  taskId: number;
  bidCount: number;
}

export interface GetWorkerBidResponse {
  taskId: number;
  worker: string;
  hasBid: boolean;
  bid: AuctionBid | null;
}

export interface SelectWinnerRequest {
  taskId: number;
  customer: string;
  worker: string;
  winningBid: string; // BigInt as string
}

export interface SelectWinnerResponse {
  taskId: number;
  customer: string;
  worker: string;
  winningBid: string;
  expiry: number;
  signature: string;
}

export interface ConfirmWinnerRequest {
  taskId: number;
  winner: string;
  winningBid: string;
}

export interface ConfirmWinnerResponse {
  success: boolean;
  taskId: number;
}

export interface AuctionErrorResponse {
  error: string;
  details?: Record<string, string>;
}

// ==========================================
// Dispute Types
// ==========================================

export enum ResolutionType {
  FavorCustomer = 0,
  FavorWorker = 1,
  Partial = 2,
}

// Database row type
export interface DisputeRow {
  id: number;
  task_id: number;
  initiator: string;
  reason_hash: string;
  disputed_at: string;
  resolution_type: number | null;
  worker_pct: number | null;
  worker_amount: string | null;
  customer_refund: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  block_number: number;
  tx_hash: string;
  created_at: string;
  updated_at: string;
}

// API response types
export interface DisputeInfo {
  taskId: number;
  initiator: string;
  reasonHash: string;
  disputedAt: string;
  isResolved: boolean;
  resolution?: {
    type: ResolutionType;
    workerPct: number;
    workerAmount: string;
    customerRefund: string;
    resolvedAt: string;
    resolvedBy: string;
  };
}

export interface DisputeListResponse {
  disputes: DisputeInfo[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DisputeStatsResponse {
  totalDisputes: number;
  openDisputes: number;
  resolvedDisputes: number;
  avgResolutionTimeHours: number;
  resolutionBreakdown: {
    favorCustomer: number;
    favorWorker: number;
    partial: number;
  };
}

export interface DisputeErrorResponse {
  error: string;
}

// ==========================================
// GitHub Bot Types
// ==========================================

// Database row type
export interface GitHubMergeLogRow {
  id: number;
  task_id: number;
  pr_url: string;
  action: string;  // 'approve', 'merge', 'approve_and_merge'
  success: boolean;
  error_message: string | null;
  pr_owner: string | null;
  pr_repo: string | null;
  pr_number: number | null;
  merge_sha: string | null;
  created_at: string;
}

// API request/response types
export interface ValidatePrRequest {
  prUrl: string;
}

export interface ValidatePrResponse {
  valid: boolean;
  error?: string;
  state?: string;  // 'open', 'closed', 'merged'
  title?: string;
  mergeable?: boolean;
}

export interface GitHubStatusResponse {
  github: {
    enabled: boolean;
    configured: boolean;
    appId: number;
  };
  watcher: {
    isRunning: boolean;
    startedAt: Date | null;
    eventsProcessed: number;
    mergesAttempted: number;
    mergesSucceeded: number;
    mergesFailed: number;
    lastError: string | null;
    lastEventBlock: number;
  };
}

export interface GitHubLogsResponse {
  logs: GitHubMergeLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface GitHubTaskLogsResponse {
  taskId: number;
  logs: GitHubMergeLogRow[];
}

export interface GitHubRetryResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface ParsePrResponse {
  valid: boolean;
  error?: string;
  owner?: string;
  repo?: string;
  pullNumber?: number;
}

export interface GitHubErrorResponse {
  error: string;
}

// ==========================================
// DelegationV2 Types (Off-Chain EIP-712 Delegations)
// ==========================================

// Request to store a signed delegation
export interface DelegationV2Request {
  delegator: string;
  delegate: string;
  vpAmount: string;      // BigInt as string, 0 = full delegation
  nonce: number;
  expiry: number;        // Unix timestamp
  signature: string;
}

// Generic success/error response
export interface DelegationV2Response {
  success: boolean;
  message?: string;
}

// User's active delegations
export interface UserDelegationsResponse {
  delegator: string;
  delegations: Array<{
    delegate: string;
    vpAmount: string;
    nonce: number;
    expiry: string;       // ISO timestamp
  }>;
  totalDelegated: string; // BigInt as string
  hasFullDelegation: boolean;
}

// Delegations received by a delegate (V2 off-chain)
export interface ReceivedDelegationsV2Response {
  delegate: string;
  delegations: Array<{
    delegator: string;
    vpAmount: string;
    nonce: number;
    expiry: string;
  }>;
  totalReceived: string;
}

// Request to revoke delegation(s) - requires signed authorization
export interface RevokeDelegationRequest {
  delegator: string;
  delegate: string | null; // null = revoke all
  timestamp: number;       // Unix timestamp for freshness
  signature: string;       // Signature proving delegator ownership
}

// Revocation response
export interface RevokeDelegationResponse {
  success: boolean;
  revokedCount: number;
}

// Next nonce for a delegator
export interface NextNonceResponse {
  delegator: string;
  nextNonce: number;
}

// Delegation stats for monitoring
export interface DelegationV2StatsResponse {
  totalDelegations: number;
  activeDelegations: number;
  uniqueDelegators: number;
  uniqueDelegates: number;
}

// EIP-712 config for frontend
export interface DelegationEIP712ConfigResponse {
  domain: {
    name: string;
    version: string;
    chainId: number;
  };
  types: {
    Delegation: Array<{ name: string; type: string }>;
  };
}

export interface DelegationV2ErrorResponse {
  error: string;
  details?: Record<string, string>;
}

// ==========================================
// Governance VP Snapshot Types (Fast Track)
// ==========================================

// Merkle proof response for Fast Track voting
export interface MerkleProofResponse {
  address: string;
  effectiveVP: string;      // VP after delegations applied
  baseVP: string;           // VP before delegations
  delegatedTo: string | null;
  delegatedAmount: string;
  proof: string[];
}

export interface MerkleProofErrorResponse {
  error: string;
}

// ==========================================
// Governance VP Available Types (Slow Track Aliases)
// ==========================================

// Available VP response for Slow Track voting
export interface VPAvailableResponse {
  user: string;
  totalVP: string;
  allocatedVP: string;
  availableVP: string;
  allocations: Array<{
    proposalId: number;
    vpAmount: string;
    support: boolean;
    deadline: number;
  }>;
}

// Attestation request for Slow Track voting
export interface VPAttestationRequest {
  user: string;
  proposalId: number;
  support: boolean;
  vpAmount: string;
  totalVP: string;
}

// Attestation response for Slow Track voting
export interface VPAttestationResponse {
  user: string;
  proposalId: number;
  support: boolean;
  vpAmount: string;
  availableVP: string;
  nonce: string;
  expiry: number;
  signature: string;
}
