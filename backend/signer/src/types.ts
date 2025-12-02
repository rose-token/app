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
