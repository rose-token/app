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
