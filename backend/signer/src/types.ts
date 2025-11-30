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
