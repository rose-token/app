import { createContext, useContext, useState, useCallback } from 'react';
import { useAccount } from 'wagmi';

const PassportVerifyContext = createContext();

// Backend signer URL from environment
const SIGNER_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

// Valid actions that can be signed
const VALID_ACTIONS = ['createTask', 'stake', 'claim', 'propose'];

/**
 * Request a signature from the backend passport signer
 * @param {string} address - Wallet address
 * @param {string} action - Action type (createTask, stake, claim)
 * @returns {Promise<{expiry: number, signature: string}>} Signature data
 */
const requestSignature = async (address, action) => {
  if (!VALID_ACTIONS.includes(action)) {
    throw new Error(`Invalid action: ${action}`);
  }

  const response = await fetch(`${SIGNER_URL}/api/passport/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ address, action }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return {
    expiry: data.expiry,
    signature: data.signature,
  };
};

/**
 * Fetch current score from backend
 * @param {string} address - Wallet address
 * @returns {Promise<{score: number, thresholds: object}>} Score data
 */
const fetchScoreFromBackend = async (address) => {
  const response = await fetch(`${SIGNER_URL}/api/passport/score/${address}`);

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return {
    score: data.score,
    thresholds: data.thresholds,
  };
};

export const PassportVerifyProvider = ({ children }) => {
  const { address, isConnected } = useAccount();
  const [state, setState] = useState({
    loading: false,
    error: null,
    lastSignature: null,
    lastAction: null,
  });

  /**
   * Request a signed approval for a marketplace action
   * @param {string} action - Action type (createTask, stake, claim)
   * @returns {Promise<{expiry: number, signature: string}>} Signature data
   */
  const getSignature = useCallback(async (action) => {
    if (!address || !isConnected) {
      throw new Error('Wallet not connected');
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const result = await requestSignature(address, action);

      setState({
        loading: false,
        error: null,
        lastSignature: result.signature,
        lastAction: action,
      });

      return result;
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err.message,
      }));
      throw err;
    }
  }, [address, isConnected]);

  /**
   * Get the signer address from the backend
   * @returns {Promise<string>} Signer address
   */
  const getSignerAddress = useCallback(async () => {
    const response = await fetch(`${SIGNER_URL}/api/passport/signer`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data.address;
  }, []);

  /**
   * Get the current thresholds from backend
   * @returns {Promise<object>} Thresholds object
   */
  const getThresholds = useCallback(async () => {
    const response = await fetch(`${SIGNER_URL}/api/passport/thresholds`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data;
  }, []);

  /**
   * Get current passport score from backend
   * @returns {Promise<{score: number, thresholds: object}>}
   */
  const getScore = useCallback(async () => {
    if (!address) {
      throw new Error('No address connected');
    }

    return fetchScoreFromBackend(address);
  }, [address]);

  /**
   * Clear any error state
   */
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  const value = {
    loading: state.loading,
    error: state.error,
    lastSignature: state.lastSignature,
    lastAction: state.lastAction,
    getSignature,
    getSignerAddress,
    getThresholds,
    getScore,
    clearError,
    signerUrl: SIGNER_URL,
    isConfigured: Boolean(SIGNER_URL),
  };

  return (
    <PassportVerifyContext.Provider value={value}>
      {children}
    </PassportVerifyContext.Provider>
  );
};

export const usePassportVerify = () => {
  const context = useContext(PassportVerifyContext);
  if (!context) {
    throw new Error('usePassportVerify must be used within a PassportVerifyProvider');
  }
  return context;
};
