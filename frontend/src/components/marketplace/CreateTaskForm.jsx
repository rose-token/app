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
import { GITHUB_INTEGRATION } from '../../constants/github';
import Spinner from '../ui/Spinner';
import SkillSelect from '../profile/SkillSelect';

const CreateTaskForm = ({ onTaskCreated }) => {
  const [title, setTitle] = useState('');
  const [detailedDescription, setDetailedDescription] = useState('');
  const [deposit, setDeposit] = useState('');
  const [isAuction, setIsAuction] = useState(true);
  const [useGithubIntegration, setUseGithubIntegration] = useState(GITHUB_INTEGRATION.DEFAULT_ENABLED);
  const [selectedSkills, setSelectedSkills] = useState([]);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { address: account, isConnected } = useAccount();
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

      // Step 1: Upload detailed description to IPFS (with GitHub integration flag and skills)
      console.log('📤 Uploading detailed description to IPFS...');
      const hash = await uploadTaskDescription(detailedDescription, title, useGithubIntegration, selectedSkills);
      console.log('✅ Uploaded to IPFS:', hash);

      const tokenAmount = parseEther(deposit);

      // Step 2: Approve token transfer
      console.log('⛽ Approving token transfer...');
      console.log('💡 Please confirm the approval transaction in your wallet');

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
        console.log('💡 Please confirm the create auction task transaction in your wallet');

        const createTaskHash = await writeContractAsync({
          address: marketplaceAddress,
          abi: RoseMarketplaceABI,
          functionName: 'createAuctionTask',
          args: [title, tokenAmount, hash, useGithubIntegration, BigInt(expiry), signature],
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

        // Build optimistic task for immediate UI display (auction)
        const optimisticTask = {
          id: taskId !== null ? Number(taskId) : null,
          customer: account,
          worker: null,
          stakeholder: null,
          deposit: tokenAmount.toString(),
          stakeholderDeposit: '0',
          description: title,
          detailedDescription: hash,
          prUrl: '',
          status: 0, // StakeholderRequired
          customerApproval: false,
          stakeholderApproval: false,
          source: 0, // Customer
          proposalId: '0',
          isAuction: true,
          winningBid: '0',
          isOptimistic: true,
        };

        console.log('🎉 Auction task created successfully!');

        // Reset form and notify parent with optimistic task
        setTitle('');
        setDetailedDescription('');
        setDeposit('');
        setIsAuction(false);
        setUseGithubIntegration(GITHUB_INTEGRATION.DEFAULT_ENABLED);
        setSelectedSkills([]);
        setIsSubmitting(false);

        if (onTaskCreated) {
          onTaskCreated(optimisticTask);
        }
        return;
      } else {
        console.log('⛽ Creating task...');
        console.log('💡 Please confirm the create task transaction in your wallet');

        const createTaskHash = await writeContractAsync({
          address: marketplaceAddress,
          abi: RoseMarketplaceABI,
          functionName: 'createTask',
          args: [title, tokenAmount, hash, useGithubIntegration, BigInt(expiry), signature],
          ...GAS_SETTINGS,
        });

        console.log('✅ Task creation transaction sent:', createTaskHash);
        console.log('⏳ Waiting for transaction confirmation...');

        // Wait for transaction to be confirmed
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: createTaskHash,
          confirmations: 1
        });

        // Parse TaskCreated event to get taskId
        let taskId = null;
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: RoseMarketplaceABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === 'TaskCreated') {
              taskId = decoded.args.taskId;
              break;
            }
          } catch {
            // Not the event we're looking for
          }
        }

        // Build optimistic task for immediate UI display
        const optimisticTask = {
          id: taskId !== null ? Number(taskId) : null,
          customer: account,
          worker: null,
          stakeholder: null,
          deposit: tokenAmount.toString(),
          stakeholderDeposit: '0',
          description: title,
          detailedDescription: hash,
          prUrl: '',
          status: 0, // StakeholderRequired
          customerApproval: false,
          stakeholderApproval: false,
          source: 0, // Customer
          proposalId: '0',
          isAuction: false,
          winningBid: '0',
          isOptimistic: true,
        };

        console.log('🎉 Task created successfully and confirmed on blockchain!');

        // Reset form and notify parent with optimistic task
        setTitle('');
        setDetailedDescription('');
        setDeposit('');
        setIsAuction(false);
        setUseGithubIntegration(GITHUB_INTEGRATION.DEFAULT_ENABLED);
        setSelectedSkills([]);
        setIsSubmitting(false);

        if (onTaskCreated) {
          onTaskCreated(optimisticTask);
        }
        return;
      }
    } catch (err) {
      console.error('❌ Error creating task:', err);
      setIsSubmitting(false);

      // Handle different error types
      if (err.message && err.message.includes('Pinata')) {
        setError('Failed to upload task description to IPFS. Please check your Pinata configuration.');
      } else if (err.message && (err.message.includes('User rejected') || err.message.includes('user rejected'))) {
        setError('Transaction rejected. Please approve the transaction in your wallet to continue.');
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
        className="rounded-[20px] backdrop-blur-[20px] p-7 mb-8 transition-colors duration-300"
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
        className="rounded-[20px] backdrop-blur-[20px] p-7 mb-8 transition-colors duration-300 hover:border-[rgba(212,175,140,0.35)]"
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

        {/* GitHub Integration Toggle */}
        {GITHUB_INTEGRATION.ENABLED && (
          <div className="mb-5">
            <label
              className="flex items-center justify-between cursor-pointer p-4 rounded-xl transition-all duration-200 hover:border-[rgba(212,175,140,0.35)]"
              style={{
                background: 'var(--bg-secondary)',
                border: useGithubIntegration
                  ? '1px solid var(--rose-gold)'
                  : '1px solid var(--border-subtle)',
              }}
            >
              <div className="flex items-center gap-3">
                <svg
                  className="w-5 h-5"
                  style={{ color: useGithubIntegration ? 'var(--rose-gold)' : 'var(--text-muted)' }}
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                <div>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    Enable GitHub Integration
                  </span>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Auto-merge PR when task is approved
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Tooltip */}
                <div className="relative group">
                  <svg
                    className="w-4 h-4 cursor-help"
                    style={{ color: 'var(--text-muted)' }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div
                    className="absolute bottom-full right-0 mb-2 w-64 p-3 rounded-lg text-xs invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-200 z-50"
                    style={{
                      background: 'var(--bg-card-solid)',
                      border: '1px solid var(--border-subtle)',
                      boxShadow: 'var(--shadow-card)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {GITHUB_INTEGRATION.TOOLTIP_TEXT}
                  </div>
                </div>
                {/* Toggle Switch */}
                <div
                  className="relative w-11 h-6 rounded-full transition-colors duration-200"
                  style={{
                    background: useGithubIntegration
                      ? 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)'
                      : 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={useGithubIntegration}
                    onChange={(e) => setUseGithubIntegration(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform duration-200"
                    style={{
                      background: useGithubIntegration ? 'white' : 'var(--text-muted)',
                      transform: useGithubIntegration ? 'translateX(20px)' : 'translateX(0)',
                    }}
                  />
                </div>
              </div>
            </label>
          </div>
        )}

        {/* Skills Selection (Optional) */}
        <div className="mb-5">
          <label style={labelStyle}>
            Required Skills (Optional)
          </label>
          <SkillSelect
            selected={selectedSkills}
            onChange={setSelectedSkills}
            max={10}
            disabled={isSubmitting}
          />
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            Select skills needed for this task. Workers with matching skills will see a star indicator.
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
          className="w-full py-3.5 px-6 rounded-xl font-semibold text-sm transition-colors duration-300 flex items-center justify-center"
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
              <Spinner className="h-4 w-4 mr-2" />
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
