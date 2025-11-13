import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useEthereum } from '../../hooks/useEthereum';
import { useContract } from '../../hooks/useContract';
import { NETWORK_IDS, NETWORK_NAMES } from '../../constants/networks';
import { uploadTaskDescription } from '../../utils/ipfs/pinataService';

const CreateTaskForm = ({ onTaskCreated }) => {
  const [title, setTitle] = useState('');
  const [detailedDescription, setDetailedDescription] = useState('');
  const [deposit, setDeposit] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState('');
  const [localContractsReady, setLocalContractsReady] = useState(false);

  const { isConnected, chainId } = useEthereum();
  const {
    roseMarketplace,
    roseToken,
    isLoading,
    error: contractError,
    contractMethods,
    contractsReady
  } = useContract();

  useEffect(() => {
    if (!isConnected) {
      setLocalContractsReady(false);
      return;
    }

    if (!isLoading && roseMarketplace && roseToken) {
      if (contractMethods.initialized && contractMethods.valid && contractsReady.readWrite) {
        setLocalContractsReady(true);
        setError('');
      } else if (contractMethods.initialized && !contractMethods.valid) {
        console.error('Contract methods validation failed');
        setLocalContractsReady(false);
        setError('Contract initialization error: createTask function not available');
      } else if (contractsReady.readOnly && !contractsReady.readWrite) {
        setLocalContractsReady(false);
        setError('Please connect your wallet to create tasks');
      }
    } else if (contractError) {
      setLocalContractsReady(false);
      setError(`Contract error: ${contractError}`);
    }
  }, [roseMarketplace, roseToken, isLoading, contractError, contractMethods, contractsReady, isConnected]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isConnected) {
      setError('Please connect your wallet first');
      return;
    }

    if (chainId !== NETWORK_IDS.SEPOLIA) {
      setError(`Please switch to ${NETWORK_NAMES[NETWORK_IDS.SEPOLIA]} to create tasks`);
      return;
    }

    if (!title || title.trim().length === 0) {
      setError('Task title is required');
      return;
    }

    if (!detailedDescription || detailedDescription.trim().length === 0) {
      setError('Detailed description is required');
      return;
    }

    if (!deposit || parseFloat(deposit) <= 0) {
      setError('Token amount must be greater than zero');
      return;
    }

    if (!localContractsReady) {
      if (!isConnected) {
        setError('Please connect your wallet to create tasks');
      } else if (contractsReady.readOnly && !contractsReady.readWrite) {
        setError('Wallet connected but contracts not initialized for write operations. Please wait a moment.');
      } else {
        setError('Contracts not properly initialized. Please refresh the page or reconnect your wallet.');
      }
      console.error('Contract state:', {
        marketplaceExists: !!roseMarketplace,
        tokenExists: !!roseToken,
        isLoading,
        localContractsReady,
        contractsReady
      });
      return;
    }

    try {
      setError('');

      // Step 1: Upload detailed description to IPFS
      setIsCreating(true);
      console.log('Uploading detailed description to IPFS...');
      const ipfsHash = await uploadTaskDescription(detailedDescription, title);
      console.log('Uploaded to IPFS:', ipfsHash);

      const tokenAmount = ethers.utils.parseEther(deposit);

      console.log('Using contracts:', {
        marketplaceAddress: roseMarketplace.address,
        tokenAddress: roseToken.address
      });

      // Step 2: Approve token transfer
      setIsApproving(true);
      setIsCreating(false);
      const approveTx = await roseToken.approve(roseMarketplace.address, tokenAmount);
      await approveTx.wait();
      setIsApproving(false);

      // Step 3: Create task with IPFS hash
      setIsCreating(true);
      const tx = await roseMarketplace.createTask(
        title,
        tokenAmount,
        ipfsHash
      );

      await tx.wait();

      // Reset form
      setTitle('');
      setDetailedDescription('');
      setDeposit('');

      if (onTaskCreated) {
        onTaskCreated();
      }
    } catch (err) {
      console.error('Error creating task:', err);

      if (err.message && err.message.includes('Pinata')) {
        setError('Failed to upload task description to IPFS. Please check your Pinata configuration.');
      } else if (err.code === 'INVALID_ARGUMENT') {
        setError('Invalid argument to createTask function. Check parameter types.');
      } else if (err.message && err.message.includes('not a function')) {
        setError('Contract method not found. Please refresh the page or reconnect your wallet.');

        console.error('Contract state when error occurred:', {
          marketplaceExists: !!roseMarketplace,
          tokenExists: !!roseToken,
          isLoading,
          contractsReady,
          contractMethods: contractMethods || 'N/A'
        });
      } else if (err.message && err.message.includes('user rejected')) {
        setError('Transaction rejected. Please try again.');
      } else if (err.message && err.message.includes('insufficient funds')) {
        setError('Insufficient funds for transaction. Please check your balance.');
      } else {
        setError(err.message || 'Failed to create task');
      }
    } finally {
      setIsApproving(false);
      setIsCreating(false);
    }
  };

  if (isLoading) {
    return <div className="text-center py-4">Loading contracts...</div>;
  }

  if (!isConnected) {
    return (
      <div className="bg-card rounded-lg shadow-md p-6 mb-6 border border-border">
        <h2 className="text-xl font-semibold text-foreground mb-4">Create New Task</h2>
        <div className="text-center py-4 text-secondary">
          Please connect your wallet to create tasks
        </div>
      </div>
    );
  }

  if (contractsReady && contractsReady.readOnly && !contractsReady.readWrite) {
    return (
      <div className="bg-card rounded-lg shadow-md p-6 mb-6 border border-border">
        <h2 className="text-xl font-semibold text-foreground mb-4">Create New Task</h2>
        <div className="text-center py-4 text-secondary">
          Wallet connected but waiting for contract initialization. Please wait a moment...
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg shadow-md p-6 mb-6 border border-border">
      <h2 className="text-xl font-semibold text-foreground mb-4">Create New Task</h2>

      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label htmlFor="title" className="block text-sm font-medium text-foreground mb-1">
            Task Title *
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground"
            placeholder="e.g., Build a responsive landing page"
            required
            maxLength={100}
          />
          <p className="mt-1 text-sm text-muted">
            Public title visible to everyone ({title.length}/100)
          </p>
        </div>

        <div className="mb-4">
          <label htmlFor="detailedDescription" className="block text-sm font-medium text-foreground mb-1">
            Detailed Description *
          </label>
          <textarea
            id="detailedDescription"
            value={detailedDescription}
            onChange={(e) => setDetailedDescription(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground"
            rows="6"
            placeholder="Provide comprehensive details about the task requirements, deliverables, timeline, etc. Only visible to task participants."
            required
          />
          <p className="mt-1 text-sm text-muted">
            Private - Only visible to customer, stakeholder, and worker. ({detailedDescription.length} characters)
          </p>
        </div>

        <div className="mb-6">
          <label htmlFor="deposit" className="block text-sm font-medium text-foreground mb-1">
            Payment Amount (ROSE Tokens) *
          </label>
          <div className="relative">
            <input
              id="deposit"
              type="number"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground"
              placeholder="e.g., 100"
              step="0.01"
              min="0.01"
              required
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <span className="text-muted-foreground">ROSE</span>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted">
            This amount in ROSE tokens will be paid to the worker upon successful completion
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-destructive/20 text-destructive rounded-md border border-destructive">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isCreating || isApproving || !isConnected}
          className={`w-full py-2 px-4 rounded-md font-medium ${
            isCreating || isApproving || !isConnected
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          {isApproving ? 'Approving ROSE Tokens...' : isCreating ? 'Creating Task...' : 'Create Task'}
        </button>

      </form>
    </div>
  );
};

export default CreateTaskForm;
