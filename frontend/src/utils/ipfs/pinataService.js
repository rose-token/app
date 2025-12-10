import axios from 'axios';

const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

const ipfsCache = new Map();

export const uploadCommentToIPFS = async (content) => {
  try {
    const apiKey = import.meta.env.VITE_PINATA_API_KEY;
    const apiSecret = import.meta.env.VITE_PINATA_SECRET_API_KEY;

    if (!apiKey || !apiSecret) {
      throw new Error('Pinata API keys not configured');
    }

    const url = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
    const data = {
      pinataContent: {
        content: content,
        timestamp: Date.now(),
        version: '1.0'
      },
      pinataMetadata: {
        name: `Rose Token Comment ${Date.now()}`
      }
    };

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json',
        'pinata_api_key': apiKey,
        'pinata_secret_api_key': apiSecret
      }
    });

    ipfsCache.set(response.data.IpfsHash, data.pinataContent);
    
    return response.data.IpfsHash; // This is the CID
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
        const response = await axios.get(`${PINATA_GATEWAY}${cid}`);
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
  return typeof str === 'string' && str.startsWith('Qm') && str.length >= 46;
};

export const uploadProposalToIPFS = async (proposalData) => {
  try {
    const apiKey = import.meta.env.VITE_PINATA_API_KEY;
    const apiSecret = import.meta.env.VITE_PINATA_SECRET_API_KEY;

    if (!apiKey || !apiSecret) {
      throw new Error('Pinata API keys not configured');
    }

    const url = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
    const data = {
      pinataContent: {
        ...proposalData,
        timestamp: Date.now(),
        version: '1.0'
      },
      pinataMetadata: {
        name: `Rose Token Proposal ${Date.now()}`
      }
    };

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json',
        'pinata_api_key': apiKey,
        'pinata_secret_api_key': apiSecret
      }
    });

    ipfsCache.set(response.data.IpfsHash, data.pinataContent);
    
    return response.data.IpfsHash; // This is the CID
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
        const response = await axios.get(`${PINATA_GATEWAY}${cid}`);
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
 * Upload a file (e.g., image) to IPFS via Pinata
 * @param {File} file - File to upload
 * @returns {Promise<{IpfsHash: string}>} Upload result with IPFS hash
 */
export const uploadFileToIPFS = async (file) => {
  const apiKey = import.meta.env.VITE_PINATA_API_KEY;
  const apiSecret = import.meta.env.VITE_PINATA_SECRET_API_KEY;

  if (!apiKey || !apiSecret) {
    throw new Error('Pinata API keys not configured');
  }

  const formData = new FormData();
  formData.append('file', file);

  const metadata = JSON.stringify({
    name: `avatar-${Date.now()}`,
    keyvalues: {
      type: 'profile-avatar',
    },
  });
  formData.append('pinataMetadata', metadata);

  try {
    const response = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      formData,
      {
        maxBodyLength: 'Infinity',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
          pinata_api_key: apiKey,
          pinata_secret_api_key: apiSecret,
        },
      }
    );

    return response.data;
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
 * @returns {Promise<string>} IPFS hash
 */
export const uploadTaskDescription = async (detailedDescription, title, githubIntegration = true) => {
  if (!detailedDescription || detailedDescription.trim().length === 0) {
    throw new Error('Detailed description is required');
  }

  const apiKey = import.meta.env.VITE_PINATA_API_KEY;
  const apiSecret = import.meta.env.VITE_PINATA_SECRET_API_KEY;

  if (!apiKey || !apiSecret) {
    throw new Error('Pinata API keys not configured');
  }

  const content = {
    title: title,
    description: detailedDescription,
    githubIntegration: githubIntegration,
    uploadedAt: new Date().toISOString(),
    version: '1.0'
  };

  try {
    const url = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
    const data = {
      pinataContent: content,
      pinataMetadata: {
        name: `task-description-${Date.now()}`,
        keyvalues: {
          type: 'task-description',
          title: title
        }
      }
    };

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json',
        'pinata_api_key': apiKey,
        'pinata_secret_api_key': apiSecret
      }
    });

    // Cache the content
    ipfsCache.set(response.data.IpfsHash, content);

    return response.data.IpfsHash;
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
      const url = `${PINATA_GATEWAY}${ipfsHash}`;
      const response = await axios.get(url);

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

  const apiKey = import.meta.env.VITE_PINATA_API_KEY;
  const apiSecret = import.meta.env.VITE_PINATA_SECRET_API_KEY;

  if (!apiKey || !apiSecret) {
    throw new Error('Pinata API keys not configured');
  }

  const content = {
    taskId: taskId,
    reason: reason.trim(),
    initiator: initiator,
    role: role,
    timestamp: Date.now(),
    version: '1.0'
  };

  try {
    const url = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
    const data = {
      pinataContent: content,
      pinataMetadata: {
        name: `dispute-reason-task-${taskId}-${Date.now()}`,
        keyvalues: {
          type: 'dispute-reason',
          taskId: taskId.toString(),
          role: role
        }
      }
    };

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json',
        'pinata_api_key': apiKey,
        'pinata_secret_api_key': apiSecret
      }
    });

    // Cache the content
    ipfsCache.set(response.data.IpfsHash, content);

    return response.data.IpfsHash;
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
      const url = `${PINATA_GATEWAY}${ipfsHash}`;
      const response = await axios.get(url);

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
