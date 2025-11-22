import React, { useState, useEffect } from 'react';
import { parseEther } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { NETWORK_IDS, NETWORK_NAMES } from '../../constants/networks';
import { uploadTaskDescription } from '../../utils/ipfs/pinataService';
import RoseMarketplaceABI from '../../contracts/RoseMarketplaceABI.json';
import RoseTokenABI from '../../contracts/RoseTokenABI.json';

const CreateTaskForm = ({ onTaskCreated }) => {
  const [title, setTitle] = useState('');
  const [detailedDescription, setDetailedDescription] = useState('');
  const [deposit, setDeposit] = useState('');
  const [error, setError] = useState('');
  const [ipfsHash, setIpfsHash] = useState('');

  const { address: account, isConnected, chain } = useAccount();
  const chainId = chain?.id;

  const marketplaceAddress = import.meta.env.VITE_MARKETPLACE_ADDRESS;
  const tokenAddress = import.meta.env.VITE_TOKEN_ADDRESS;

  // Wagmi write hooks
  const {
    data: approveHash,
    writeContract: approveToken,
    isPending: isApproving,
  } = useWriteContract();

  const {
    data: createTaskHash,
    writeContract: createTask,
    isPending: isCreating,
  } = useWriteContract();

  // Wait for approve transaction
  const { isLoading: isApproveTxPending, isSuccess: isApproveSuccess } =
    useWaitForTransactionReceipt({
      hash: approveHash,
    });

  // Wait for create task transaction
  const { isLoading: isCreateTxPending, isSuccess: isCreateSuccess } =
    useWaitForTransactionReceipt({
      hash: createTaskHash,
    });

  // When approve succeeds, call createTask
  useEffect(() => {
    if (isApproveSuccess && ipfsHash && deposit) {
      const tokenAmount = parseEther(deposit);

      createTask({
        address: marketplaceAddress,
        abi: RoseMarketplaceABI,
        functionName: 'createTask',
        args: [title, tokenAmount, ipfsHash],
      });
    }
  }, [isApproveSuccess, ipfsHash, deposit, title, marketplaceAddress, createTask]);

  // When createTask succeeds, reset form
  useEffect(() => {
    if (isCreateSuccess) {
      setTitle('');
      setDetailedDescription('');
      setDeposit('');
      setIpfsHash('');

      if (onTaskCreated) {
        onTaskCreated();
      }
    }
  }, [isCreateSuccess, onTaskCreated]);

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

    try {
      setError('');

      // Step 1: Upload detailed description to IPFS
      console.log('Uploading detailed description to IPFS...');
      const hash = await uploadTaskDescription(detailedDescription, title);
      console.log('Uploaded to IPFS:', hash);
      setIpfsHash(hash);

      const tokenAmount = parseEther(deposit);

      console.log('Approving token transfer...');
      // Step 2: Approve token transfer (wagmi hook)
      approveToken({
        address: tokenAddress,
        abi: RoseTokenABI,
        functionName: 'approve',
        args: [marketplaceAddress, tokenAmount],
      });

      // Step 3 happens automatically in useEffect when approve succeeds
    } catch (err) {
      console.error('Error creating task:', err);

      if (err.message && err.message.includes('Pinata')) {
        setError('Failed to upload task description to IPFS. Please check your Pinata configuration.');
      } else if (err.message && err.message.includes('user rejected')) {
        setError('Transaction rejected. Please try again.');
      } else if (err.message && err.message.includes('insufficient funds')) {
        setError('Insufficient funds for transaction. Please check your balance.');
      } else {
        setError(err.message || 'Failed to create task');
      }
    }
  };

  if (!isConnected) {
    return (
      <div className="bg-card rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold text-foreground mb-4">Create New Task</h2>
        <div className="text-center py-4 text-secondary">
          Please connect your wallet to create tasks
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg shadow-md p-6 mb-6">
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
          disabled={isApproving || isApproveTxPending || isCreating || isCreateTxPending || !isConnected}
          className={`w-full py-2 px-4 rounded-md font-medium ${
            isApproving || isApproveTxPending || isCreating || isCreateTxPending || !isConnected
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:bg-primary'
          }`}
        >
          {isApproving || isApproveTxPending
            ? 'Approving ROSE Tokens...'
            : isCreating || isCreateTxPending
            ? 'Creating Task...'
            : 'Create Task'}
        </button>

      </form>
    </div>
  );
};

export default CreateTaskForm;
