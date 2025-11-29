/**
 * Profile CRUD service for Ceramic/ComposeDB
 * Handles creating, reading, and updating user profiles
 */

import { getComposeClient } from './client';

/**
 * Create a new profile on Ceramic
 * @param {DIDSession} session - Authenticated DID session
 * @param {Object} profileData - Profile data to create
 * @returns {Promise<Object>} Created profile with stream ID
 */
export const createProfile = async (session, profileData) => {
  const client = getComposeClient();

  if (!client) {
    throw new Error('Ceramic client not available');
  }

  if (!session?.did) {
    throw new Error('Authenticated session required');
  }

  // Ensure DID is set on client
  client.setDID(session.did);

  const now = new Date().toISOString();

  const profile = {
    displayName: profileData.displayName || '',
    bio: profileData.bio || '',
    avatarUrl: profileData.avatarUrl || '',
    skills: profileData.skills || [],
    website: profileData.website || '',
    twitter: profileData.twitter || '',
    github: profileData.github || '',
    walletAddress: profileData.walletAddress,
    joinedAt: now,
    lastActiveAt: now,
  };

  try {
    // ComposeDB mutation to create profile
    const result = await client.executeQuery(`
      mutation CreateProfile($input: CreateRoseProfileInput!) {
        createRoseProfile(input: $input) {
          document {
            id
            displayName
            bio
            avatarUrl
            skills
            website
            twitter
            github
            walletAddress
            joinedAt
            lastActiveAt
          }
        }
      }
    `, {
      input: {
        content: profile,
      },
    });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Failed to create profile');
    }

    return {
      ...result.data.createRoseProfile.document,
      streamId: result.data.createRoseProfile.document.id,
    };
  } catch (err) {
    console.error('Failed to create profile:', err);
    throw err;
  }
};

/**
 * Update an existing profile on Ceramic
 * @param {DIDSession} session - Authenticated DID session
 * @param {string} streamId - Profile document stream ID
 * @param {Object} updates - Profile fields to update
 * @returns {Promise<Object>} Updated profile
 */
export const updateProfile = async (session, streamId, updates) => {
  const client = getComposeClient();

  if (!client) {
    throw new Error('Ceramic client not available');
  }

  if (!session?.did) {
    throw new Error('Authenticated session required');
  }

  // Ensure DID is set on client
  client.setDID(session.did);

  const updateData = {
    ...updates,
    lastActiveAt: new Date().toISOString(),
  };

  // Remove any undefined values
  Object.keys(updateData).forEach((key) => {
    if (updateData[key] === undefined) {
      delete updateData[key];
    }
  });

  try {
    const result = await client.executeQuery(`
      mutation UpdateProfile($input: UpdateRoseProfileInput!) {
        updateRoseProfile(input: $input) {
          document {
            id
            displayName
            bio
            avatarUrl
            skills
            website
            twitter
            github
            walletAddress
            joinedAt
            lastActiveAt
          }
        }
      }
    `, {
      input: {
        id: streamId,
        content: updateData,
      },
    });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Failed to update profile');
    }

    return {
      ...result.data.updateRoseProfile.document,
      streamId: result.data.updateRoseProfile.document.id,
    };
  } catch (err) {
    console.error('Failed to update profile:', err);
    throw err;
  }
};

/**
 * Get a profile by wallet address
 * @param {string} address - Ethereum wallet address
 * @returns {Promise<Object|null>} Profile data or null if not found
 */
export const getProfileByAddress = async (address) => {
  const client = getComposeClient();

  if (!client) {
    console.warn('Ceramic client not available');
    return null;
  }

  try {
    const result = await client.executeQuery(`
      query GetProfileByAddress($address: String!) {
        roseProfileIndex(first: 1, filters: { where: { walletAddress: { equalTo: $address } } }) {
          edges {
            node {
              id
              displayName
              bio
              avatarUrl
              skills
              website
              twitter
              github
              walletAddress
              joinedAt
              lastActiveAt
            }
          }
        }
      }
    `, {
      address: address.toLowerCase(),
    });

    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      return null;
    }

    const edges = result.data?.roseProfileIndex?.edges;

    if (!edges || edges.length === 0) {
      return null;
    }

    const profile = edges[0].node;

    return {
      ...profile,
      streamId: profile.id,
    };
  } catch (err) {
    console.error('Failed to fetch profile by address:', err);
    return null;
  }
};

/**
 * Get own profile (for authenticated user)
 * Uses the viewer pattern which is more efficient for own profile
 * @param {DIDSession} session - Authenticated DID session
 * @returns {Promise<Object|null>} Profile data or null if not found
 */
export const getOwnProfile = async (session) => {
  const client = getComposeClient();

  if (!client) {
    console.warn('Ceramic client not available');
    return null;
  }

  if (!session?.did) {
    return null;
  }

  // Ensure DID is set on client
  client.setDID(session.did);

  try {
    const result = await client.executeQuery(`
      query GetOwnProfile {
        viewer {
          roseProfile {
            id
            displayName
            bio
            avatarUrl
            skills
            website
            twitter
            github
            walletAddress
            joinedAt
            lastActiveAt
          }
        }
      }
    `);

    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      return null;
    }

    const profile = result.data?.viewer?.roseProfile;

    if (!profile) {
      return null;
    }

    return {
      ...profile,
      streamId: profile.id,
    };
  } catch (err) {
    console.error('Failed to fetch own profile:', err);
    return null;
  }
};

/**
 * Check if a profile exists for an address
 * @param {string} address - Ethereum wallet address
 * @returns {Promise<boolean>} True if profile exists
 */
export const profileExists = async (address) => {
  const profile = await getProfileByAddress(address);
  return profile !== null;
};

/**
 * Create or update profile (upsert)
 * @param {DIDSession} session - Authenticated DID session
 * @param {Object} profileData - Profile data
 * @returns {Promise<Object>} Created or updated profile
 */
export const upsertProfile = async (session, profileData) => {
  const existing = await getOwnProfile(session);

  if (existing) {
    return updateProfile(session, existing.streamId, profileData);
  }

  return createProfile(session, profileData);
};
