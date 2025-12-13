/**
 * useIPFSImage hook
 * Fetches private IPFS images with authentication and returns blob URLs
 *
 * Private Pinata files require JWT auth headers, but browsers cannot add
 * custom headers to <img src> requests. This hook fetches images via
 * JavaScript with proper auth and returns blob URLs that can be used in <img src>.
 */

import { useState, useEffect } from 'react';
import { fetchIPFSImage } from '../utils/ipfs/pinataService';

// Module-level cache for blob URLs (persists across component instances)
const blobUrlCache = new Map();

/**
 * Hook to fetch private IPFS images with authentication
 * @param {string} ipfsUrl - IPFS URL (ipfs://CID) or CID string, or null
 * @returns {{ blobUrl: string|null, loading: boolean, error: Error|null }}
 */
export const useIPFSImage = (ipfsUrl) => {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ipfsUrl) {
      setBlobUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Extract CID from ipfs:// URL or use as-is
    const cid = ipfsUrl.startsWith('ipfs://')
      ? ipfsUrl.replace('ipfs://', '')
      : ipfsUrl;

    // Check cache first
    if (blobUrlCache.has(cid)) {
      setBlobUrl(blobUrlCache.get(cid));
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const fetchImage = async () => {
      setLoading(true);
      setError(null);

      try {
        const blob = await fetchIPFSImage(cid);
        const url = URL.createObjectURL(blob);

        if (!cancelled) {
          blobUrlCache.set(cid, url);
          setBlobUrl(url);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching IPFS image:', err);
          setError(err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchImage();

    return () => {
      cancelled = true;
    };
  }, [ipfsUrl]);

  return { blobUrl, loading, error };
};

export default useIPFSImage;
