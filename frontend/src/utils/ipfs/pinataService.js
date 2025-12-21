import { PinataSDK } from 'pinata';

// Dedicated gateway for private files
const PINATA_GATEWAY = import.meta.env.VITE_PINATA_GATEWAY || 'https://coffee-glad-felidae-720.mypinata.cloud';

// Group IDs for organizing content
const PINATA_GROUPS = {
  GOVERNANCE: '019b0af9-c866-7bc5-b659-8d6b70da8cd8',
  TASKS: '019b0aec-a5a0-7338-be66-3d604b7ba713',      // Tasks + Disputes
  PROFILES: '019b0aec-c443-7ada-bcb7-5221e69121db',
};

const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

const ipfsCache = new Map();

/**
 * Initialize Pinata SDK singleton
 * @returns {PinataSDK} Configured Pinata instance
 */
const initPinataSDK = () => {
  const jwt = import.meta.env.VITE_PINATA_JWT;

  if (!jwt) {
    throw new Error('Pinata JWT not configured');
  }

  // SDK expects domain without protocol
  const gatewayDomain = PINATA_GATEWAY.replace(/^https?:\/\//, '');

  return new PinataSDK({
    pinataJwt: jwt,
    pinataGateway: gatewayDomain
  });
};

let pinataInstance = null;
const getPinata = () => {
  if (!pinataInstance) {
    pinataInstance = initPinataSDK();
  }
  return pinataInstance;
};

/**
 * Internal wrapper for SDK uploads with retry logic
 * @param {Function} uploadFn - SDK upload function to execute
 * @param {number} retries - Number of retry attempts
 * @returns {Promise<{cid: string}>}
 */
const uploadWithSDK = async (uploadFn, retries = MAX_RETRIES) => {
  try {
    const result = await uploadFn();
    return { cid: result.cid };
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return uploadWithSDK(uploadFn, retries - 1);
    }
    throw error;
  }
};

/**
 * Internal wrapper for SDK downloads with retry logic
 * @param {string} cid - IPFS CID
 * @param {number} retries - Number of retry attempts
 * @returns {Promise<any>} Parsed data (JSON object or Blob)
 */
const fetchWithSDK = async (cid, retries = MAX_RETRIES) => {
  try {
    const result = await getPinata().gateways.private.get(cid);
    return result.data;
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return fetchWithSDK(cid, retries - 1);
    }
    throw error;
  }
};

/**
 * Get the gateway URL for a CID
 * @param {string} cid - IPFS CID
 * @returns {string} Full gateway URL
 */
export const getGatewayUrl = (cid) => `${PINATA_GATEWAY}/ipfs/${cid}`;

export const uploadCommentToIPFS = async (content) => {
  try {
    const data = {
      content: content,
      timestamp: Date.now(),
      version: '1.0'
    };

    const result = await uploadWithSDK(() =>
      getPinata().upload.private.json(data)
        .group(PINATA_GROUPS.PROFILES)
        .name(`profile-${Date.now()}.json`)
    );

    ipfsCache.set(result.cid, data);
    return result.cid;
  } catch (error) {
    console.error('Error uploading to IPFS:', error);
    throw error;
  }
};

export const fetchCommentFromIPFS = async (cid) => {
  try {
    if (ipfsCache.has(cid)) {
      const cached = ipfsCache.get(cid);
      return cached.isEncrypted ? cached : cached.content;
    }

    const data = await fetchWithSDK(cid);
    ipfsCache.set(cid, data);

    return data.isEncrypted ? data : data.content;
  } catch (error) {
    console.error('Error fetching from IPFS:', error);
    throw error;
  }
};

export const uploadProposalToIPFS = async (proposalData) => {
  try {
    const data = {
      ...proposalData,
      timestamp: Date.now(),
      version: '1.0'
    };

    const result = await uploadWithSDK(() =>
      getPinata().upload.private.json(data)
        .group(PINATA_GROUPS.GOVERNANCE)
        .name(`proposal-${Date.now()}.json`)
    );

    ipfsCache.set(result.cid, data);
    return result.cid;
  } catch (error) {
    console.error('Error uploading proposal to IPFS:', error);
    throw error;
  }
};

export const fetchProposalFromIPFS = async (cid) => {
  try {
    if (ipfsCache.has(cid)) {
      return ipfsCache.get(cid);
    }

    const data = await fetchWithSDK(cid);
    ipfsCache.set(cid, data);

    return data;
  } catch (error) {
    console.error('Error fetching proposal from IPFS:', error);
    throw error;
  }
};

export const isValidUrl = (url) => {
  if (!url) return false;
  const urlPattern = /^(data:image\/|https:\/\/)/;
  return urlPattern.test(url);
};

/**
 * Upload a file (e.g., image) to IPFS via Pinata SDK
 * @param {File} file - File to upload
 * @returns {Promise<{IpfsHash: string}>} Upload result with IPFS hash
 */
export const uploadFileToIPFS = async (file) => {
  try {
    const result = await uploadWithSDK(() =>
      getPinata().upload.private.file(file)
        .group(PINATA_GROUPS.PROFILES)
        .name(`avatar-${Date.now()}-${file.name}`)
    );

    // Maintain backward compatibility with { IpfsHash } response format
    return { IpfsHash: result.cid };
  } catch (error) {
    console.error('Error uploading file to IPFS:', error);
    throw new Error('Failed to upload file to IPFS');
  }
};

/**
 * Upload detailed task description to IPFS
 * @param {string} detailedDescription - Markdown or plain text description
 * @param {string} title - Task title (for metadata)
 * @param {boolean} githubIntegration - Whether GitHub integration is enabled for this task
 * @param {string[]} skills - Array of skill IDs required for this task
 * @returns {Promise<string>} IPFS hash
 */
export const uploadTaskDescription = async (detailedDescription, title, githubIntegration = true, skills = []) => {
  if (!detailedDescription || detailedDescription.trim().length === 0) {
    throw new Error('Detailed description is required');
  }

  try {
    const content = {
      title: title,
      description: detailedDescription,
      githubIntegration: githubIntegration,
      skills: skills,
      uploadedAt: new Date().toISOString(),
      version: '1.0'
    };

    const result = await uploadWithSDK(() =>
      getPinata().upload.private.json(content)
        .group(PINATA_GROUPS.TASKS)
        .name(`task-description-${Date.now()}.json`)
    );

    ipfsCache.set(result.cid, content);
    return result.cid;
  } catch (error) {
    console.error('Error uploading to IPFS:', error);
    throw new Error('Failed to upload task description to IPFS');
  }
};

/**
 * Fetch detailed task description from IPFS
 * @param {string} ipfsHash - IPFS hash
 * @returns {Promise<Object>} Task description object
 */
export const fetchTaskDescription = async (ipfsHash) => {
  if (!ipfsHash || ipfsHash.length === 0) {
    throw new Error('IPFS hash is required');
  }

  // Check cache first
  if (ipfsCache.has(ipfsHash)) {
    return ipfsCache.get(ipfsHash);
  }

  try {
    const data = await fetchWithSDK(ipfsHash);

    if (!data) {
      throw new Error('No data returned from IPFS');
    }

    // Cache the result
    ipfsCache.set(ipfsHash, data);

    return data;
  } catch (error) {
    console.error('Error fetching from IPFS:', error);
    throw new Error('Failed to fetch task description from IPFS');
  }
};

/**
 * Upload dispute reason to IPFS
 * @param {number} taskId - Task ID
 * @param {string} reason - Dispute reason text
 * @param {string} initiator - Address of dispute initiator
 * @param {string} role - 'customer' or 'worker'
 * @returns {Promise<string>} IPFS hash
 */
export const uploadDisputeReason = async (taskId, reason, initiator, role) => {
  if (!reason || reason.trim().length < 20) {
    throw new Error('Dispute reason must be at least 20 characters');
  }

  try {
    const content = {
      taskId: taskId,
      reason: reason.trim(),
      initiator: initiator,
      role: role,
      timestamp: Date.now(),
      version: '1.0'
    };

    const result = await uploadWithSDK(() =>
      getPinata().upload.private.json(content)
        .group(PINATA_GROUPS.TASKS)
        .name(`dispute-reason-task-${taskId}-${Date.now()}.json`)
    );

    ipfsCache.set(result.cid, content);
    return result.cid;
  } catch (error) {
    console.error('Error uploading dispute reason to IPFS:', error);
    throw new Error('Failed to upload dispute reason to IPFS');
  }
};

/**
 * Fetch dispute reason from IPFS
 * @param {string} ipfsHash - IPFS hash
 * @returns {Promise<Object>} Dispute reason object
 */
export const fetchDisputeReason = async (ipfsHash) => {
  if (!ipfsHash || ipfsHash.length === 0) {
    throw new Error('IPFS hash is required');
  }

  // Check cache first
  if (ipfsCache.has(ipfsHash)) {
    return ipfsCache.get(ipfsHash);
  }

  try {
    const data = await fetchWithSDK(ipfsHash);

    if (!data) {
      throw new Error('No data returned from IPFS');
    }

    // Cache the result
    ipfsCache.set(ipfsHash, data);

    return data;
  } catch (error) {
    console.error('Error fetching dispute reason from IPFS:', error);
    throw new Error('Failed to fetch dispute reason from IPFS');
  }
};

/**
 * Fetch image/binary content from IPFS with authentication
 * Used for private files that require JWT auth (e.g., profile avatars)
 * @param {string} cid - IPFS CID
 * @returns {Promise<Blob>} Image blob
 */
export const fetchIPFSImage = async (cid) => {
  try {
    const blob = await fetchWithSDK(cid);

    // SDK returns Blob directly for binary content
    if (!(blob instanceof Blob)) {
      throw new Error('Expected Blob response for image');
    }

    return blob;
  } catch (error) {
    console.error('Error fetching image from IPFS:', error);
    throw new Error('Failed to fetch image from IPFS');
  }
};
