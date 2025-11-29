/**
 * Batch profile fetching hook
 * Fetches multiple profiles at once for task lists
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3000';

/**
 * Hook for batch fetching profiles
 * @param {string[]} addresses - Array of addresses to fetch
 * @returns {Object} { profiles, isLoading, error, refetch }
 */
export function useProfiles(addresses = []) {
  const [profiles, setProfiles] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Track previous addresses to avoid unnecessary fetches
  const prevAddressesRef = useRef('');

  const fetchProfiles = useCallback(async (addressList) => {
    if (!addressList || addressList.length === 0) {
      setProfiles({});
      return;
    }

    // Filter valid addresses
    const validAddresses = addressList.filter(
      (addr) => addr && addr.startsWith('0x') && addr.length === 42
    );

    if (validAddresses.length === 0) {
      setProfiles({});
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_URL}/api/profiles?addresses=${validAddresses.join(',')}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch profiles');
      }

      const data = await response.json();
      setProfiles(data.profiles || {});
    } catch (err) {
      console.error('Error fetching profiles:', err);
      setError(err.message);
      setProfiles({});
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch when addresses change
  useEffect(() => {
    const addressKey = addresses.sort().join(',');
    if (addressKey !== prevAddressesRef.current) {
      prevAddressesRef.current = addressKey;
      fetchProfiles(addresses);
    }
  }, [addresses, fetchProfiles]);

  const refetch = useCallback(() => {
    fetchProfiles(addresses);
  }, [addresses, fetchProfiles]);

  return {
    profiles,
    isLoading,
    error,
    refetch,
  };
}

export default useProfiles;
