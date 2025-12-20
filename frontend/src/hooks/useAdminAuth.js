/**
 * Admin Authentication Hook
 *
 * Centralized hook for creating signed admin requests.
 * All admin hooks reuse this for consistent signature generation.
 *
 * Security model:
 * - Signs: keccak256(abi.encodePacked(callerAddress, action, timestamp))
 * - Backend verifies signature proves caller controls Treasury.owner() wallet
 * - Timestamp prevents replay attacks (5-min window)
 */

import { useCallback } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { keccak256, encodePacked, toBytes } from 'viem';

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Hook providing utilities for authenticated admin API requests.
 *
 * @returns {Object} Admin auth utilities
 * @returns {Function} createSignedRequest - Create signed request payload for a given action
 * @returns {Function} adminPost - POST request with signature authentication
 * @returns {Function} adminDelete - DELETE request with signature authentication
 */
export const useAdminAuth = () => {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  /**
   * Create a signed request payload for admin authentication.
   *
   * @param {string} action - Action string (e.g., 'backup-create', 'whitelist-add')
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
   * Make an authenticated POST request to an admin endpoint.
   *
   * @param {string} endpoint - API endpoint path (e.g., '/api/backup/create')
   * @param {string} action - Action string for signature (e.g., 'backup-create')
   * @param {Object} body - Additional body fields to include in request
   * @returns {Promise<Response>} Fetch response object
   * @throws {Error} If wallet not connected or signing fails
   */
  const adminPost = useCallback(
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
   * Make an authenticated DELETE request to an admin endpoint.
   *
   * @param {string} endpoint - API endpoint path (e.g., '/api/whitelist/0x...')
   * @param {string} action - Action string for signature (e.g., 'whitelist-remove')
   * @returns {Promise<Response>} Fetch response object
   * @throws {Error} If wallet not connected or signing fails
   */
  const adminDelete = useCallback(
    async (endpoint, action) => {
      const signedRequest = await createSignedRequest(action);

      return fetch(`${API_URL}${endpoint}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signedRequest),
      });
    },
    [createSignedRequest]
  );

  return { createSignedRequest, adminPost, adminDelete };
};

export default useAdminAuth;
