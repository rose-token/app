import React, { useState } from 'react';
import { parseEther, parseGwei } from 'viem';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { uploadTaskDescription } from '../../utils/ipfs/pinataService';
import RoseMarketplaceABI from '../../contracts/RoseMarketplaceABI.json';
import RoseTokenABI from '../../contracts/RoseTokenABI.json';

const CreateTaskForm = ({ onTaskCreated }) => {
  const [title, setTitle] = useState('');
  const [detailedDescription, setDetailedDescription] = useState('');
  const [deposit, setDeposit] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { isConnected } = useAccount();
  const publicClient = usePublicClient();

  const marketplaceAddress = import.meta.env.VITE_MARKETPLACE_ADDRESS;
  const tokenAddress = import.meta.env.VITE_TOKEN_ADDRESS;

  // Use writeContractAsync for promise-based flow
  const { writeContractAsync } = useWriteContract();

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent double submission
    if (isSubmitting) {
      console.log('⚠️ Already submitting, ignoring duplicate submission');
      return;
    }

    if (!isConnected) {
      setError('Please connect your wallet first');
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
      setIsSubmitting(true);

      // Step 1: Upload detailed description to IPFS
      console.log('📤 Uploading detailed description to IPFS...');
      const hash = await uploadTaskDescription(detailedDescription, title);
      console.log('✅ Uploaded to IPFS:', hash);

      const tokenAmount = parseEther(deposit);

      // Step 2: Approve token transfer
      console.log('⛽ Approving token transfer...');
      console.log('💡 Please confirm the approval transaction in MetaMask');

      const approveHash = await writeContractAsync({
        address: tokenAddress,
        abi: RoseTokenABI,
        functionName: 'approve',
        args: [marketplaceAddress, tokenAmount],
        maxFeePerGas: parseGwei('4'),
        maxPriorityFeePerGas: parseGwei('2'),
      });

      console.log('✅ Approval transaction sent:', approveHash);
      console.log('⏳ Waiting for approval confirmation...');

      // Step 3: Create task
      console.log('⛽ Creating task...');
      console.log('💡 Please confirm the create task transaction in MetaMask');

      const createTaskHash = await writeContractAsync({
        address: marketplaceAddress,
        abi: RoseMarketplaceABI,
        functionName: 'createTask',
        args: [title, tokenAmount, hash],
        gas: 500_000n,
        maxFeePerGas: parseGwei('4'),
        maxPriorityFeePerGas: parseGwei('2'),
      });

      console.log('✅ Task creation transaction sent:', createTaskHash);
      console.log('⏳ Waiting for transaction confirmation...');

      // Wait for transaction to be confirmed
      await publicClient.waitForTransactionReceipt({
        hash: createTaskHash,
        confirmations: 1
      });

      console.log('🎉 Task created successfully and confirmed on blockchain!');

      // Reset form
      setTitle('');
      setDetailedDescription('');
      setDeposit('');
      setIsSubmitting(false);

      if (onTaskCreated) {
        onTaskCreated();
      }
    } catch (err) {
      console.error('❌ Error creating task:', err);
      setIsSubmitting(false);

      // Handle different error types
      if (err.message && err.message.includes('Pinata')) {
        setError('Failed to upload task description to IPFS. Please check your Pinata configuration.');
      } else if (err.message && (err.message.includes('User rejected') || err.message.includes('user rejected'))) {
        setError('Transaction rejected. Please approve the transaction in MetaMask to continue.');
      } else if (err.message && err.message.includes('insufficient funds')) {
        setError('Insufficient funds for transaction. Please check your ETH and ROSE token balances.');
      } else if (err.message && err.message.includes('ERC20: insufficient allowance')) {
        setError('Insufficient token allowance. Please try again.');
      } else {
        setError(err.message || 'Failed to create task. Please try again.');
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
            placeholder="Provide comprehensive details about the task requirements, deliverables, timeline, etc."
            required
          />
          <p className="mt-1 text-sm text-muted">
            Visible to everyone. ({detailedDescription.length} characters)
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
              onWheel={(e) => e.currentTarget.blur()}
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
          disabled={isSubmitting || !isConnected}
          className={`w-full py-2 px-4 rounded-md font-medium ${
            isSubmitting || !isConnected
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:bg-primary'
          }`}
        >
          {isSubmitting ? (
            <>
              <span className="animate-pulse inline-block mr-2">✨</span>
              Creating Task...
            </>
          ) : (
            'Create Task'
          )}
        </button>

      </form>
    </div>
  );
};

export default CreateTaskForm;
