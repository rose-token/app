export type Action = 'createTask' | 'stake' | 'claim';

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
  };
}

export interface SignerResponse {
  signer: string;
}

export interface ThresholdsResponse {
  createTask: number;
  stake: number;
  claim: number;
}
