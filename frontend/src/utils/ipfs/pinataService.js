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
 * Upload detailed task description to IPFS
 * @param {string} detailedDescription - Markdown or plain text description
 * @param {string} title - Task title (for metadata)
 * @returns {Promise<string>} IPFS hash
 */
export const uploadTaskDescription = async (detailedDescription, title) => {
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
