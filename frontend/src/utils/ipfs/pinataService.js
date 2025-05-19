import axios from 'axios';

const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

const ipfsCache = new Map();

export const uploadCommentToIPFS = async (content) => {
  try {
    const apiKey = process.env.REACT_APP_PINATA_API_KEY;
    const apiSecret = process.env.REACT_APP_PINATA_SECRET_API_KEY;
    
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

export const uploadEncryptedCommentToIPFS = async (content, publicKeys) => {
  try {
    const { encryptForRecipients } = await import('../encryption/pgpService');
      
    const encryptedContent = await encryptForRecipients(content, publicKeys);
      
    const apiKey = process.env.REACT_APP_PINATA_API_KEY;
    const apiSecret = process.env.REACT_APP_PINATA_SECRET_API_KEY;
      
    if (!apiKey || !apiSecret) {
      throw new Error('Pinata API keys not configured');
    }
  
    const url = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
    const data = {
      pinataContent: {
        encryptedContent: encryptedContent,
        timestamp: Date.now(),
        version: '1.0',
        isEncrypted: true
      },
      pinataMetadata: {
        name: `Rose Token Encrypted Comment ${Date.now()}`
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
    console.error('Error uploading encrypted comment to IPFS:', error);
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

export const isValidUrl = (url) => {
  if (!url) return false;
  const urlPattern = /^(data:image\/|https:\/\/)/;
  return urlPattern.test(url);
};
