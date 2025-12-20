/**
 * User Authentication Hook
 *
 * Centralized hook for creating signed user requests.
 * All user mutation hooks reuse this for consistent signature generation.
 *
 * Security model:
 * - Signs: keccak256(abi.encodePacked(callerAddress, action, timestamp))
 * - Backend verifies signature proves caller controls the claimed wallet
 * - Timestamp prevents replay attacks (5-min window)
 *
 * Key difference from useAdminAuth:
 * - useAdminAuth: For owner-only endpoints (Treasury.owner())
 * - useUserAuth: For user-facing endpoints (self-attestation)
 */

import { useCallback } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { keccak256, encodePacked, toBytes } from 'viem';

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Hook providing utilities for authenticated user API requests.
 *
 * @returns {Object} User auth utilities
 * @returns {Function} createSignedRequest - Create signed request payload for a given action
 * @returns {Function} userPost - POST request with signature authentication
 * @returns {Function} userDelete - DELETE request with signature authentication
 */
export const useUserAuth = () => {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  /**
   * Create a signed request payload for user authentication.
   *
   * @param {string} action - Action string (e.g., 'github-unlink', 'github-repo-authorize')
   * @returns {Promise<Object>} Object with callerAddress, timestamp, signature
   * @throws {Error} If wallet not connected or signing fails
   */
  const createSignedRequest = useCallback(
    async (action) => {
      if (!address) {
        throw new Error('Wallet not connected');
      }

      if (!walletClient) {
        throw new Error('Wallet client not available');
      }

      const timestamp = Math.floor(Date.now() / 1000);

      // Create message hash matching backend format:
      // keccak256(abi.encodePacked(callerAddress, action, timestamp))
      const messageHash = keccak256(
        encodePacked(['address', 'string', 'uint256'], [address, action, BigInt(timestamp)])
      );

      // Sign the message hash to prove wallet ownership
      const signature = await walletClient.signMessage({
        message: { raw: toBytes(messageHash) },
      });

      return {
        callerAddress: address,
        timestamp,
        signature,
      };
    },
    [address, walletClient]
  );

  /**
   * Make an authenticated POST request to a user endpoint.
   *
   * @param {string} endpoint - API endpoint path (e.g., '/api/github/repos/authorize')
   * @param {string} action - Action string for signature (e.g., 'github-repo-authorize')
   * @param {Object} body - Additional body fields to include in request
   * @returns {Promise<Response>} Fetch response object
   * @throws {Error} If wallet not connected or signing fails
   */
  const userPost = useCallback(
    async (endpoint, action, body = {}) => {
      const signedRequest = await createSignedRequest(action);

      return fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...signedRequest }),
      });
    },
    [createSignedRequest]
  );

  /**
   * Make an authenticated DELETE request to a user endpoint.
   *
   * @param {string} endpoint - API endpoint path (e.g., '/api/github/auth/unlink')
   * @param {string} action - Action string for signature (e.g., 'github-unlink')
   * @param {Object} body - Additional body fields to include in request (for repo data)
   * @returns {Promise<Response>} Fetch response object
   * @throws {Error} If wallet not connected or signing fails
   */
  const userDelete = useCallback(
    async (endpoint, action, body = {}) => {
      const signedRequest = await createSignedRequest(action);

      return fetch(`${API_URL}${endpoint}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...signedRequest }),
      });
    },
    [createSignedRequest]
  );

  return { createSignedRequest, userPost, userDelete };
};

export default useUserAuth;
