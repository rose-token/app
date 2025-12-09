import React, { useState } from 'react';
import { parseEther, decodeEventLog } from 'viem';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { uploadTaskDescription } from '../../utils/ipfs/pinataService';
import RoseMarketplaceABI from '../../contracts/RoseMarketplaceABI.json';
import RoseTokenABI from '../../contracts/RoseTokenABI.json';
import PassportGate from '../passport/PassportGate';
import { PASSPORT_THRESHOLDS } from '../../constants/passport';
import { usePassportVerify } from '../../hooks/usePassportVerify';
import { useAuction } from '../../hooks/useAuction';
import { GAS_SETTINGS } from '../../constants/gas';

const CreateTaskForm = ({ onTaskCreated }) => {
  const [title, setTitle] = useState('');
  const [detailedDescription, setDetailedDescription] = useState('');
  const [deposit, setDeposit] = useState('');
  const [isAuction, setIsAuction] = useState(true);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { getSignature } = usePassportVerify();
  const { registerAuction } = useAuction();

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
        ...GAS_SETTINGS,
      });

      console.log('✅ Approval transaction sent:', approveHash);
      console.log('⏳ Waiting for approval confirmation...');

      await publicClient.waitForTransactionReceipt({
        hash: approveHash,
        confirmations: 1
      });
      await new Promise(r => setTimeout(r, 1000))
      // Step 3: Get passport signature
      console.log('🔐 Requesting passport signature...');
      const { expiry, signature } = await getSignature('createTask');
      console.log('✅ Passport signature obtained');

      // Step 4: Create task (fixed-price or auction)
      if (isAuction) {
        console.log('⛽ Creating auction task...');
        console.log('💡 Please confirm the create auction task transaction in MetaMask');

        const createTaskHash = await writeContractAsync({
          address: marketplaceAddress,
          abi: RoseMarketplaceABI,
          functionName: 'createAuctionTask',
          args: [title, tokenAmount, hash, BigInt(expiry), signature],
          ...GAS_SETTINGS,
        });

        console.log('✅ Auction task creation transaction sent:', createTaskHash);
        console.log('⏳ Waiting for transaction confirmation...');

        // Wait for transaction to be confirmed
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: createTaskHash,
          confirmations: 1
        });

        // Parse AuctionTaskCreated event to get taskId
        let taskId = null;
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: RoseMarketplaceABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === 'AuctionTaskCreated') {
              taskId = decoded.args.taskId;
              break;
            }
          } catch {
            // Not the event we're looking for
          }
        }

        if (taskId !== null) {
          // Register auction with backend
          console.log('📝 Registering auction with backend...');
          try {
            await registerAuction(Number(taskId), tokenAmount.toString());
            console.log('✅ Auction registered with backend');
          } catch (regErr) {
            console.warn('⚠️ Failed to register auction with backend:', regErr);
            // Non-fatal - tx succeeded on-chain
          }
        } else {
          console.warn('⚠️ Could not extract taskId from transaction logs');
        }

        console.log('🎉 Auction task created successfully!');
      } else {
        console.log('⛽ Creating task...');
        console.log('💡 Please confirm the create task transaction in MetaMask');

        const createTaskHash = await writeContractAsync({
          address: marketplaceAddress,
          abi: RoseMarketplaceABI,
          functionName: 'createTask',
          args: [title, tokenAmount, hash, BigInt(expiry), signature],
          ...GAS_SETTINGS,
        });

        console.log('✅ Task creation transaction sent:', createTaskHash);
        console.log('⏳ Waiting for transaction confirmation...');

        // Wait for transaction to be confirmed
        await publicClient.waitForTransactionReceipt({
          hash: createTaskHash,
          confirmations: 1
        });

        console.log('🎉 Task created successfully and confirmed on blockchain!');
      }

      // Reset form
      setTitle('');
      setDetailedDescription('');
      setDeposit('');
      setIsAuction(false);
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
      } else if (err.message && err.message.includes('Passport score')) {
        setError(err.message);
      } else if (err.message && err.message.includes('SignatureExpired')) {
        setError('Passport signature expired. Please try again.');
      } else if (err.message && err.message.includes('SignatureAlreadyUsed')) {
        setError('Passport signature already used. Please try again.');
      } else {
        setError(err.message || 'Failed to create task. Please try again.');
      }
    }
  };

  const labelStyle = {
    color: 'var(--text-muted)',
    fontSize: '0.6875rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '0.5rem',
    display: 'block'
  };

  const inputStyle = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    padding: '0.875rem 1rem',
    width: '100%',
    fontSize: '0.9375rem',
    transition: 'all 0.2s ease'
  };

  if (!isConnected) {
    return (
      <div
        className="rounded-[20px] backdrop-blur-[20px] p-7 mb-8 transition-all duration-300"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)'
        }}
      >
        <h2 className="font-display text-xl font-medium mb-4" style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          Create New Task
        </h2>
        <div className="text-center py-6" style={{ color: 'var(--text-secondary)' }}>
          Please connect your wallet to create tasks
        </div>
      </div>
    );
  }

  return (
    <PassportGate
      threshold={PASSPORT_THRESHOLDS.CREATE_TASK}
      action="create tasks"
    >
      <div
        className="rounded-[20px] backdrop-blur-[20px] p-7 mb-8 transition-all duration-300 hover:border-[rgba(212,175,140,0.35)]"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)'
        }}
      >
        <h2 className="font-display text-xl font-medium mb-6" style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          Create New Task
        </h2>

        <form onSubmit={handleSubmit}>
        <div className="mb-5">
          <label htmlFor="title" style={labelStyle}>
            Task Title *
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
            placeholder="e.g., Build a responsive landing page"
            required
            maxLength={100}
          />
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            Public title visible to everyone ({title.length}/100)
          </p>
        </div>

        <div className="mb-5">
          <label htmlFor="detailedDescription" style={labelStyle}>
            Detailed Description *
          </label>
          <textarea
            id="detailedDescription"
            value={detailedDescription}
            onChange={(e) => setDetailedDescription(e.target.value)}
            style={{ ...inputStyle, minHeight: '140px', resize: 'vertical' }}
            placeholder="Provide comprehensive details about the task requirements, deliverables, timeline, etc."
            required
          />
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            Visible to everyone. ({detailedDescription.length} characters)
          </p>
        </div>

        {/* Task Type Dropdown */}
        <div className="mb-5">
          <label style={labelStyle}>Task Type</label>
          <select
            value={isAuction ? 'auction' : 'fixed'}
            onChange={(e) => setIsAuction(e.target.value === 'auction')}
            className="w-full rounded-xl py-2.5 px-4 text-sm cursor-pointer transition-all duration-200"
            style={{
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              outline: 'none',
            }}
          >
            <option value="auction">Auction</option>
            <option value="fixed">Fixed Price</option>
          </select>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            {isAuction
              ? 'Workers will bid to complete this task. You select the winning bid.'
              : 'Set a fixed payment amount. Workers can claim this task directly.'}
          </p>
        </div>

        <div className="mb-6">
          <label htmlFor="deposit" style={labelStyle}>
            {isAuction ? 'Maximum Budget *' : 'Payment Amount *'}
          </label>
          <div className="relative">
            <input
              id="deposit"
              type="number"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              style={inputStyle}
              placeholder="e.g., 100"
              step="0.01"
              min="0.01"
              onWheel={(e) => e.currentTarget.blur()}
              required
            />
            <div
              className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-sm font-medium"
              style={{ color: 'var(--rose-gold)' }}
            >
              ROSE
            </div>
          </div>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            {isAuction
              ? 'Maximum amount you\'re willing to pay. Workers will bid below this.'
              : 'This amount will be paid to the worker upon successful completion'}
          </p>
        </div>

        {error && (
          <div
            className="mb-5 p-4 rounded-xl text-sm"
            style={{
              background: 'var(--error-bg)',
              border: '1px solid rgba(248, 113, 113, 0.3)',
              color: 'var(--error)'
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !isConnected}
          className="w-full py-3.5 px-6 rounded-xl font-semibold text-sm transition-all duration-300"
          style={{
            background: isSubmitting || !isConnected
              ? 'var(--bg-secondary)'
              : 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
            color: isSubmitting || !isConnected
              ? 'var(--text-muted)'
              : 'var(--bg-primary)',
            boxShadow: isSubmitting || !isConnected
              ? 'none'
              : '0 4px 16px rgba(212, 165, 165, 0.3)',
            cursor: isSubmitting || !isConnected ? 'not-allowed' : 'pointer',
            opacity: isSubmitting || !isConnected ? 0.6 : 1
          }}
        >
          {isSubmitting ? (
            <>
              <span className="inline-block mr-2 animate-pulse">⚡</span>
              {isAuction ? 'Creating Auction...' : 'Creating Task...'}
            </>
          ) : (
            isAuction ? 'Create Auction Task' : 'Create Task'
          )}
        </button>
        </form>
      </div>
    </PassportGate>
  );
};

export default CreateTaskForm;
