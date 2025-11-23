import React, { useState, useEffect, useRef } from 'react';
import { parseEther, parseGwei } from 'viem';
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

  // Ref to track if we've already called createTask for this approval
  const createTaskCalledRef = useRef(false);
  const lastApproveHashRef = useRef(null);

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

  // When approve succeeds, call createTask with gas estimation
  // Use ref to prevent infinite loop
  useEffect(() => {
    const executeCreateTask = async () => {
      // Check if this is a new approval (hash changed) or first time
      if (isApproveSuccess && ipfsHash && deposit && account) {
        // Reset flag if we have a new approval hash
        if (approveHash !== lastApproveHashRef.current) {
          createTaskCalledRef.current = false;
          lastApproveHashRef.current = approveHash;
        }

        // Only call createTask once per approval
        if (!createTaskCalledRef.current) {
          createTaskCalledRef.current = true;
          const tokenAmount = parseEther(deposit);

          try {
            console.log('⛽ Creating task with hardcoded 2 gwei gas...');
            await createTask({
              address: marketplaceAddress,
              abi: RoseMarketplaceABI,
              functionName: 'createTask',
              args: [title, tokenAmount, ipfsHash],
              gasPrice: parseGwei('2'),
              maxFeePerGas: parseGwei('2'),
              maxPriorityFeePerGas: parseGwei('2'),
            });
          } catch (err) {
            console.error('❌ Error creating task:', err);
            createTaskCalledRef.current = false; // Reset on error so user can retry
          }
        }
      }
    };

    executeCreateTask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isApproveSuccess, ipfsHash, deposit, title, marketplaceAddress, account, approveHash]);

  // When createTask succeeds, reset form
  useEffect(() => {
    if (isCreateSuccess) {
      setTitle('');
      setDetailedDescription('');
      setDeposit('');
      setIpfsHash('');

      // Reset refs for next task creation
      createTaskCalledRef.current = false;
      lastApproveHashRef.current = null;

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

      console.log('⛽ Approving token transfer with hardcoded 2 gwei gas...');
      // Step 2: Approve token transfer with hardcoded gas
      await approveToken({
        address: tokenAddress,
        abi: RoseTokenABI,
        functionName: 'approve',
        args: [marketplaceAddress, tokenAmount],
        gasPrice: parseGwei('2'),
        maxFeePerGas: parseGwei('2'),
        maxPriorityFeePerGas: parseGwei('2'),
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
