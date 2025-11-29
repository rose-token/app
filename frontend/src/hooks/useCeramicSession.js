/**
 * Ceramic DID Session hook with context provider
 * Manages DID authentication and session state
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import {
  getOrCreateSession,
  loadStoredSession,
  restoreSession,
  clearSession,
  isSessionValid,
} from '../services/ceramic/session';
import { isCeramicAvailable, getConnectionError } from '../services/ceramic/client';

const CeramicSessionContext = createContext();

/**
 * Ceramic Session Provider component
 * Wraps app to provide DID session state and authentication
 */
export const CeramicSessionProvider = ({ children }) => {
  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [state, setState] = useState({
    session: null,
    isAuthenticated: false,
    hasProfile: null, // null = unknown, true = has profile, false = no profile
    showProfilePrompt: false,
    loading: false,
    error: null,
  });

  /**
   * Try to restore existing session from localStorage
   */
  const tryRestoreSession = useCallback(async () => {
    if (!address || !isConnected) {
      setState((prev) => ({
        ...prev,
        session: null,
        isAuthenticated: false,
        hasProfile: null,
        showProfilePrompt: false,
      }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const stored = loadStoredSession(address);

      if (stored && !stored.isExpired) {
        const restored = await restoreSession(stored.session);

        if (restored && isSessionValid(restored)) {
          setState((prev) => ({
            ...prev,
            session: restored,
            isAuthenticated: true,
            loading: false,
          }));
          return;
        }
      }

      // No valid session found
      setState((prev) => ({
        ...prev,
        session: null,
        isAuthenticated: false,
        loading: false,
      }));
    } catch (err) {
      console.error('Error restoring session:', err);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to restore session',
      }));
    }
  }, [address, isConnected]);

  /**
   * Authenticate with wallet signature to create DID session
   */
  const authenticate = useCallback(async () => {
    if (!walletClient || !address || !isConnected) {
      setState((prev) => ({
        ...prev,
        error: 'Wallet not connected',
      }));
      return null;
    }

    if (!isCeramicAvailable()) {
      const connError = getConnectionError();
      setState((prev) => ({
        ...prev,
        error: connError?.message || 'Ceramic node not available',
      }));
      return null;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const session = await getOrCreateSession(walletClient, address, chainId || 1, true);

      setState((prev) => ({
        ...prev,
        session,
        isAuthenticated: true,
        loading: false,
        error: null,
      }));

      return session;
    } catch (err) {
      console.error('Authentication failed:', err);

      // Handle user rejection
      if (err.code === 4001 || err.message?.includes('rejected')) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: 'Signature request was rejected',
        }));
      } else {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err.message || 'Authentication failed',
        }));
      }

      return null;
    }
  }, [walletClient, address, isConnected, chainId]);

  /**
   * Logout and clear session
   */
  const logout = useCallback(() => {
    if (address) {
      clearSession(address);
    }

    setState({
      session: null,
      isAuthenticated: false,
      hasProfile: null,
      showProfilePrompt: false,
      loading: false,
      error: null,
    });
  }, [address]);

  /**
   * Set profile status (called by profile service after checking)
   */
  const setHasProfile = useCallback((hasProfile) => {
    setState((prev) => ({
      ...prev,
      hasProfile,
      // Show profile prompt if authenticated but no profile
      showProfilePrompt: prev.isAuthenticated && !hasProfile,
    }));
  }, []);

  /**
   * Dismiss the profile creation prompt
   */
  const dismissProfilePrompt = useCallback(() => {
    setState((prev) => ({
      ...prev,
      showProfilePrompt: false,
    }));
  }, []);

  /**
   * Clear any errors
   */
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  // Try to restore session when wallet connects
  useEffect(() => {
    if (isConnected && address) {
      tryRestoreSession();
    } else {
      // Clear session on disconnect
      setState({
        session: null,
        isAuthenticated: false,
        hasProfile: null,
        showProfilePrompt: false,
        loading: false,
        error: null,
      });
    }
  }, [isConnected, address, tryRestoreSession]);

  const value = {
    session: state.session,
    isAuthenticated: state.isAuthenticated,
    hasProfile: state.hasProfile,
    showProfilePrompt: state.showProfilePrompt,
    loading: state.loading,
    error: state.error,
    authenticate,
    logout,
    setHasProfile,
    dismissProfilePrompt,
    clearError,
    isCeramicAvailable: isCeramicAvailable(),
  };

  return (
    <CeramicSessionContext.Provider value={value}>{children}</CeramicSessionContext.Provider>
  );
};

/**
 * Hook to access Ceramic session state and methods
 * @returns {Object} Session state and methods
 */
export const useCeramicSession = () => {
  const context = useContext(CeramicSessionContext);

  if (!context) {
    throw new Error('useCeramicSession must be used within a CeramicSessionProvider');
  }

  return context;
};

export default useCeramicSession;
