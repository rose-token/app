import axios from 'axios';

// V3 API endpoint
const PINATA_UPLOAD_URL = 'https://uploads.pinata.cloud/v3/files';

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
 * Convert JSON object to Blob for V3 file upload
 * @param {Object} data - JSON data to convert
 * @returns {Blob} Blob containing JSON
 */
const jsonToBlob = (data) => new Blob([JSON.stringify(data)], { type: 'application/json' });

/**
 * Get the gateway URL for a CID
 * @param {string} cid - IPFS CID
 * @returns {string} Full gateway URL
 */
export const getGatewayUrl = (cid) => `${PINATA_GATEWAY}/ipfs/${cid}`;

/**
 * Get authorization headers for Pinata gateway requests
 * @returns {Object} Headers object with Authorization
 */
const getAuthHeaders = () => {
  const jwt = import.meta.env.VITE_PINATA_JWT;
  if (!jwt) {
    throw new Error('Pinata JWT not configured');
  }
  return { 'Authorization': `Bearer ${jwt}` };
};

/**
 * Upload content to Pinata V3 API (private by default)
 * @param {Blob|File} file - File or Blob to upload
 * @param {string} name - Filename for the upload
 * @param {string} groupId - Optional group ID to organize content
 * @returns {Promise<{cid: string}>} Upload result with CID
 */
const uploadToV3 = async (file, name, groupId = null) => {
  const jwt = import.meta.env.VITE_PINATA_JWT;

  if (!jwt) {
    throw new Error('Pinata JWT not configured');
  }

  const formData = new FormData();
  formData.append('file', file, name);
  formData.append('network', 'private');

  if (groupId) {
    formData.append('group_id', groupId);
  }

  const response = await axios.post(PINATA_UPLOAD_URL, formData, {
    headers: {
      'Authorization': `Bearer ${jwt}`,
    },
    maxBodyLength: Infinity,
  });

  // V3 API returns { data: { cid: '...' } }
  return { cid: response.data.data.cid };
};

export const uploadCommentToIPFS = async (content) => {
  try {
    const data = {
      content: content,
      timestamp: Date.now(),
      version: '1.0'
    };

    const blob = jsonToBlob(data);
    const result = await uploadToV3(blob, `comment-${Date.now()}.json`, null);

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

    const fetchWithRetry = async (retries) => {
      try {
        const response = await axios.get(getGatewayUrl(cid), {
          headers: getAuthHeaders()
        });
        ipfsCache.set(cid, response.data);

        return response.data.isEncrypted ? response.data : response.data.content;
      } catch (error) {
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          return fetchWithRetry(retries - 1);
        }
        throw error;
      }
    };

    return fetchWithRetry(MAX_RETRIES);
  } catch (error) {
    console.error('Error fetching from IPFS:', error);
    throw error;
  }
};

export const isCID = (str) => {
  if (typeof str !== 'string') return false;
  // CIDv0: starts with Qm, 46 chars
  // CIDv1: starts with bafy, variable length (typically 59+ chars)
  return (str.startsWith('Qm') && str.length >= 46) ||
         (str.startsWith('bafy') && str.length >= 50);
};

export const uploadProposalToIPFS = async (proposalData) => {
  try {
    const data = {
      ...proposalData,
      timestamp: Date.now(),
      version: '1.0'
    };

    const blob = jsonToBlob(data);
    const result = await uploadToV3(
      blob,
      `proposal-${Date.now()}.json`,
      PINATA_GROUPS.GOVERNANCE
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

    const fetchWithRetry = async (retries) => {
      try {
        const response = await axios.get(getGatewayUrl(cid), {
          headers: getAuthHeaders()
        });
        ipfsCache.set(cid, response.data);

        return response.data;
      } catch (error) {
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          return fetchWithRetry(retries - 1);
        }
        throw error;
      }
    };

    return fetchWithRetry(MAX_RETRIES);
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
 * Upload a file (e.g., image) to IPFS via Pinata V3 API
 * @param {File} file - File to upload
 * @returns {Promise<{IpfsHash: string}>} Upload result with IPFS hash
 */
export const uploadFileToIPFS = async (file) => {
  try {
    const result = await uploadToV3(
      file,
      `avatar-${Date.now()}-${file.name}`,
      PINATA_GROUPS.PROFILES
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

    const blob = jsonToBlob(content);
    const result = await uploadToV3(
      blob,
      `task-description-${Date.now()}.json`,
      PINATA_GROUPS.TASKS
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

  const fetchWithRetry = async (retries) => {
    try {
      const response = await axios.get(getGatewayUrl(ipfsHash), {
        headers: getAuthHeaders()
      });

      if (!response.data) {
        throw new Error('No data returned from IPFS');
      }

      // Cache the result
      ipfsCache.set(ipfsHash, response.data);

      return response.data;
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return fetchWithRetry(retries - 1);
      }
      throw error;
    }
  };

  try {
    return await fetchWithRetry(MAX_RETRIES);
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

    const blob = jsonToBlob(content);
    const result = await uploadToV3(
      blob,
      `dispute-reason-task-${taskId}-${Date.now()}.json`,
      PINATA_GROUPS.TASKS  // Disputes in Tasks group
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

  const fetchWithRetry = async (retries) => {
    try {
      const response = await axios.get(getGatewayUrl(ipfsHash), {
        headers: getAuthHeaders()
      });

      if (!response.data) {
        throw new Error('No data returned from IPFS');
      }

      // Cache the result
      ipfsCache.set(ipfsHash, response.data);

      return response.data;
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return fetchWithRetry(retries - 1);
      }
      throw error;
    }
  };

  try {
    return await fetchWithRetry(MAX_RETRIES);
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
  const fetchWithRetry = async (retries) => {
    try {
      const response = await axios.get(getGatewayUrl(cid), {
        headers: getAuthHeaders(),
        responseType: 'blob'
      });
      return response.data;
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return fetchWithRetry(retries - 1);
      }
      throw error;
    }
  };

  try {
    return await fetchWithRetry(MAX_RETRIES);
  } catch (error) {
    console.error('Error fetching image from IPFS:', error);
    throw new Error('Failed to fetch image from IPFS');
  }
};
