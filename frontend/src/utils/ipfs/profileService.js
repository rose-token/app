import { uploadCommentToIPFS, fetchCommentFromIPFS } from './pinataService';

const PROFILE_CID_KEY = 'rose-token-profile-cid';

export const uploadProfileToIPFS = async (profileData, address) => {
  try {
    const fullProfileData = {
      ...profileData,
      address,
      updatedAt: Date.now()
    };
    
    const cid = await uploadCommentToIPFS(fullProfileData);
    
    localStorage.setItem(`${PROFILE_CID_KEY}-${address.toLowerCase()}`, cid);
    
    return cid;
  } catch (error) {
    console.error('Error uploading profile to IPFS:', error);
    throw error;
  }
};

export const fetchProfileFromIPFS = async (address) => {
  try {
    const cid = localStorage.getItem(`${PROFILE_CID_KEY}-${address.toLowerCase()}`);
    
    if (!cid) {
      return null; // No profile found
    }
    
    const profileData = await fetchCommentFromIPFS(cid);
    return profileData;
  } catch (error) {
    console.error('Error fetching profile from IPFS:', error);
    return null;
  }
};
