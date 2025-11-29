/**
 * ProfilePromptHandler component
 * Shows profile creation modal for new users after wallet connect
 */

import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useCeramicSession } from '../../hooks/useCeramicSession';
import ProfileModal from './ProfileModal';

/**
 * Storage key for tracking dismissed prompt per address
 */
const PROMPT_DISMISSED_KEY = 'rose_profile_prompt_dismissed';

/**
 * Check if prompt was dismissed for this address
 */
const isPromptDismissed = (address) => {
  try {
    const dismissed = localStorage.getItem(PROMPT_DISMISSED_KEY);
    if (!dismissed) return false;

    const addresses = JSON.parse(dismissed);
    return addresses.includes(address.toLowerCase());
  } catch {
    return false;
  }
};

/**
 * Mark prompt as dismissed for this address
 */
const dismissPrompt = (address) => {
  try {
    const dismissed = localStorage.getItem(PROMPT_DISMISSED_KEY);
    const addresses = dismissed ? JSON.parse(dismissed) : [];

    if (!addresses.includes(address.toLowerCase())) {
      addresses.push(address.toLowerCase());
      localStorage.setItem(PROMPT_DISMISSED_KEY, JSON.stringify(addresses));
    }
  } catch (err) {
    console.error('Error saving prompt dismissal:', err);
  }
};

/**
 * ProfilePromptHandler
 * Renders ProfileModal when user connects and has no profile
 */
const ProfilePromptHandler = () => {
  const { address, isConnected } = useAccount();
  const { showProfilePrompt, dismissProfilePrompt, hasProfile, isAuthenticated } = useCeramicSession();
  const [showModal, setShowModal] = useState(false);

  // Check if we should show the prompt
  useEffect(() => {
    if (
      isConnected &&
      address &&
      showProfilePrompt &&
      hasProfile === false &&
      !isPromptDismissed(address)
    ) {
      // Small delay to let the wallet connection UI settle
      const timer = setTimeout(() => {
        setShowModal(true);
      }, 500);

      return () => clearTimeout(timer);
    } else {
      setShowModal(false);
    }
  }, [isConnected, address, showProfilePrompt, hasProfile]);

  // Handle modal close
  const handleClose = () => {
    setShowModal(false);

    if (address) {
      dismissPrompt(address);
    }

    dismissProfilePrompt();
  };

  // Don't render anything if conditions aren't met
  if (!isConnected || !address || hasProfile !== false) {
    return null;
  }

  return (
    <ProfileModal
      isOpen={showModal}
      onClose={handleClose}
      mode="create"
    />
  );
};

export default ProfilePromptHandler;
