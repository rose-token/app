import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import RoseTreasuryABI from '../../contracts/RoseTreasuryABI.json';
import RoseTokenABI from '../../contracts/RoseTokenABI.json';
import { GAS_SETTINGS } from '../../constants/gas';

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

// Format cooldown seconds to human readable
const formatCooldown = (seconds) => {
  if (seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
};

const RedeemCard = ({
  roseBalance,
  roseBalanceRaw,
  roseAllowance,
  roseAllowanceRaw,
  rosePrice,
  treasuryAddress,
  tokenAddress,
  onSuccess,
  redeemCooldown = 0,
  pendingRedemptionId: initialPendingId = null,
}) => {
  const { chain } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [cooldownRemaining, setCooldownRemaining] = useState(redeemCooldown);

  // Hybrid redemption state (Phase 5)
  const [redemptionMode, setRedemptionMode] = useState(initialPendingId ? 'queued' : null);
  const [pendingRequestId, setPendingRequestId] = useState(initialPendingId);
  const [isPolling, setIsPolling] = useState(!!initialPendingId);
  const [availabilityInfo, setAvailabilityInfo] = useState(null);

  // Initialize polling if there's an existing pending redemption
  useEffect(() => {
    if (initialPendingId && !pendingRequestId) {
      setPendingRequestId(initialPendingId);
      setIsPolling(true);
      setRedemptionMode('queued');
    }
  }, [initialPendingId, pendingRequestId]);

  // Live countdown timer - updates every 5 seconds to reduce re-renders
  // (cooldowns are typically hours, so second precision isn't needed)
  useEffect(() => {
    setCooldownRemaining(redeemCooldown);
    if (redeemCooldown <= 0) return;

    const interval = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 5) {
          clearInterval(interval);
          return 0;
        }
        return prev - 5;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [redeemCooldown]);

  // Check if redemption can be fulfilled instantly
  const checkRedeemAvailability = useCallback(async (roseAmountWei) => {
    if (!roseAmountWei || roseAmountWei <= 0n) {
      setAvailabilityInfo(null);
      setRedemptionMode(null);
      return null;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/treasury/redeem-check?amount=${roseAmountWei.toString()}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setAvailabilityInfo(data);
      setRedemptionMode(data.canRedeemInstantly ? 'instant' : 'queued');
      return data;
    } catch (err) {
      console.error('[RedeemCard] Error checking availability:', err);
      // Assume instant mode if check fails (fallback to old behavior)
      setRedemptionMode('instant');
      return null;
    }
  }, []);

  // Poll for pending redemption fulfillment
  useEffect(() => {
    if (!isPolling || !pendingRequestId) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/treasury/redemption/${pendingRequestId}`
        );

        if (!response.ok) {
          console.error('[RedeemCard] Poll error:', response.status);
          return;
        }

        const data = await response.json();

        if (data.fulfilled) {
          console.log('🎉 Redemption fulfilled!', data);
          setIsPolling(false);
          setPendingRequestId(null);
          setRedemptionMode(null);
          setAmount('');
          setIsSubmitting(false);
          if (onSuccess) onSuccess();
        }
      } catch (err) {
        console.error('[RedeemCard] Polling error:', err);
      }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(pollInterval);
  }, [isPolling, pendingRequestId, onSuccess]);

  // Calculate ROSE amount in wei
  const amountInWei = useMemo(() => {
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return 0n;
    try {
      return parseUnits(amount, 18); // ROSE has 18 decimals
    } catch {
      return 0n;
    }
  }, [amount]);

  // Fetch preview of USDC to receive
  const { data: usdcToReceive } = useReadContract({
    address: treasuryAddress,
    abi: RoseTreasuryABI,
    functionName: 'calculateUsdcForRedemption',
    args: [amountInWei],
    chainId: chain?.id,
    query: {
      enabled: amountInWei > 0n && !!treasuryAddress,
    },
  });

  const usdcToReceiveFormatted = useMemo(() => {
    if (!usdcToReceive) return '0.00';
    return Number(formatUnits(usdcToReceive, 6)).toFixed(2);
  }, [usdcToReceive]);

  // Always require approval for redemptions (simpler and more reliable)
  const needsApproval = amountInWei > 0n;

  // Validation
  const validationError = useMemo(() => {
    if (!amount || parseFloat(amount) <= 0) return null;
    if (roseBalance !== null && parseFloat(amount) > roseBalance) {
      return 'Insufficient ROSE balance';
    }
    return null;
  }, [amount, roseBalance]);

  const handleMaxClick = () => {
    if (roseBalance !== null) {
      setAmount(roseBalance.toString());
    }
  };

  const handleRedeem = async () => {
    if (!tokenAddress || !treasuryAddress || amountInWei <= 0n) return;

    // Validate balance before submitting transaction
    if (roseBalanceRaw !== undefined && amountInWei > roseBalanceRaw) {
      setError('Insufficient ROSE balance');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      // Step 1: Check availability
      console.log('🔍 Checking redemption availability...');
      const availability = await checkRedeemAvailability(amountInWei);
      const canInstant = availability?.canRedeemInstantly ?? true;

      // Step 2: Approve if needed (required for both instant and queued)
      if (needsApproval) {
        console.log('⛽ Approving ROSE transfer...');
        const approveHash = await writeContractAsync({
          address: tokenAddress,
          abi: RoseTokenABI,
          functionName: 'approve',
          args: [treasuryAddress, amountInWei],
          ...GAS_SETTINGS,
        });

        console.log('✅ Approval transaction sent:', approveHash);
        console.log('⏳ Waiting for approval confirmation...');

        await publicClient.waitForTransactionReceipt({
          hash: approveHash,
          confirmations: 1
        });
        await new Promise(r => setTimeout(r, 1000));
      }

      if (canInstant) {
        // Step 3a: Instant redemption (existing flow)
        console.log('⛽ Redeeming ROSE (instant)...');
        const redeemHash = await writeContractAsync({
          address: treasuryAddress,
          abi: RoseTreasuryABI,
          functionName: 'redeem',
          args: [amountInWei],
          ...GAS_SETTINGS,
        });

        console.log('✅ Redeem transaction sent:', redeemHash);
        console.log('⏳ Waiting for redeem confirmation...');

        await publicClient.waitForTransactionReceipt({
          hash: redeemHash,
          confirmations: 1,
        });

        console.log('🎉 Redemption completed successfully!');
        setAmount('');
        setRedemptionMode(null);
        setAvailabilityInfo(null);
        if (onSuccess) onSuccess();
      } else {
        // Step 3b: Queued redemption (new hybrid flow)
        console.log('⛽ Requesting queued redemption...');
        console.log(`📊 Shortfall: ${availability?.shortfall} USDC`);

        const requestHash = await writeContractAsync({
          address: treasuryAddress,
          abi: RoseTreasuryABI,
          functionName: 'requestRedemption',
          args: [amountInWei],
          ...GAS_SETTINGS,
        });

        console.log('✅ Request transaction sent:', requestHash);
        console.log('⏳ Waiting for request confirmation...');

        const receipt = await publicClient.waitForTransactionReceipt({
          hash: requestHash,
          confirmations: 1,
        });

        // Parse the RedemptionRequested event to get the request ID
        // Event signature: RedemptionRequested(uint256 indexed requestId, address indexed user, uint256 roseAmount, uint256 usdcOwed)
        const redemptionRequestedTopic = '0x'; // We'll find it from logs
        let requestId = null;

        for (const log of receipt.logs) {
          // The first topic is the event signature, second is requestId (indexed)
          if (log.topics.length >= 2 && log.address.toLowerCase() === treasuryAddress.toLowerCase()) {
            // RedemptionRequested has indexed requestId as first indexed param
            try {
              requestId = BigInt(log.topics[1]).toString();
              break;
            } catch {
              // Continue looking
            }
          }
        }

        if (requestId) {
          console.log(`📋 Redemption request queued with ID: ${requestId}`);
          setPendingRequestId(requestId);
          setIsPolling(true);
          // Keep isSubmitting true while polling - shows "Processing..." state
        } else {
          console.log('⚠️ Could not find request ID, but transaction succeeded');
          // Transaction succeeded, let user know
          setError('Redemption queued. Check back later for fulfillment.');
          setIsSubmitting(false);
        }
      }
    } catch (err) {
      console.error('❌ Redeem error:', err);
      setIsPolling(false);
      setPendingRequestId(null);

      if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
        setError('Transaction rejected. Please approve the transaction to continue.');
      } else if (err.message.includes('InsufficientBalance')) {
        setError('Insufficient ROSE balance');
      } else if (err.message.includes('InsufficientLiquidity')) {
        setError('Insufficient liquidity. Your redemption will be queued.');
        // Could auto-retry with requestRedemption here
      } else if (err.message.includes('UserHasPendingRedemption')) {
        setError('You already have a pending redemption. Please wait for it to be fulfilled.');
      } else if (err.message.includes('execution reverted')) {
        const reason = err.message.split('execution reverted:')[1]?.split('"')[0]?.trim();
        setError(reason || 'Redemption failed');
      } else {
        setError('Redemption failed. Please try again.');
      }
      setIsSubmitting(false);
    }
  };

  const canRedeem = amountInWei > 0n && !validationError && !isSubmitting && cooldownRemaining === 0;

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
    paddingRight: '4rem',
    width: '100%',
    fontSize: '0.9375rem',
    transition: 'all 0.2s ease'
  };

  return (
    <div
      className="rounded-[20px] backdrop-blur-[20px] p-7 transition-all duration-300 hover:border-[rgba(212,175,140,0.35)]"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)'
      }}
    >
      <h3 className="font-display text-xl font-medium mb-1" style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
        Redeem ROSE
      </h3>
      <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
        Receive USDC
      </p>

      {/* Cooldown Badge */}
      {cooldownRemaining > 0 && (
        <div
          className="rounded-lg px-3 py-2 mb-4 text-xs font-medium flex items-center gap-2"
          style={{
            background: 'var(--warning-bg)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
            color: 'var(--warning)',
          }}
        >
          <span>⏳</span>
          <span>Available in {formatCooldown(cooldownRemaining)}</span>
        </div>
      )}

      <div className="space-y-4">
        {/* Amount Input */}
        <div>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError('');
              }}
              placeholder="0.00"
              disabled={isSubmitting}
              style={inputStyle}
            />
            <button
              onClick={handleMaxClick}
              disabled={isSubmitting || !roseBalance}
              className="absolute right-3 top-1/2 -translate-y-1/2 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors disabled:opacity-50"
              style={{ color: 'var(--rose-gold)', background: 'rgba(212, 175, 140, 0.1)' }}
            >
              MAX
            </button>
          </div>
          {roseBalance !== null && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              Balance: {roseBalance.toLocaleString()} ROSE
            </p>
          )}
        </div>

        {/* Preview */}
        {amountInWei > 0n && (
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--info-bg)', border: '1px solid rgba(96, 165, 250, 0.3)' }}
          >
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>You will receive:</p>
            <p className="font-display text-xl font-semibold" style={{ color: 'var(--info)' }}>{usdcToReceiveFormatted} USDC</p>
            {rosePrice && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Exchange rate: 1 ROSE = ${rosePrice.toFixed(4)}
              </p>
            )}
          </div>
        )}

        {/* Validation Error */}
        {validationError && (
          <p className="text-sm" style={{ color: 'var(--error)' }}>{validationError}</p>
        )}

        {/* Error */}
        {error && (
          <div
            className="rounded-xl p-4 text-sm"
            style={{ background: 'var(--error-bg)', border: '1px solid rgba(248, 113, 113, 0.3)', color: 'var(--error)' }}
          >
            {error}
          </div>
        )}

        {/* Queued Processing Status */}
        {isPolling && pendingRequestId && (
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--warning-bg)', border: '1px solid rgba(251, 191, 36, 0.3)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="animate-spin">⏳</span>
              <p className="text-sm font-medium" style={{ color: 'var(--warning)' }}>
                Processing Redemption
              </p>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Request #{pendingRequestId} queued. Backend is liquidating assets to fulfill your redemption.
              This may take a few minutes.
            </p>
            {availabilityInfo?.shortfall && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Shortfall: {availabilityInfo.shortfall} USDC being sourced...
              </p>
            )}
          </div>
        )}

        {/* Button */}
        <button
          onClick={handleRedeem}
          disabled={!canRedeem || isPolling}
          className="w-full py-3.5 px-6 rounded-xl font-semibold text-sm transition-all duration-300"
          style={{
            background: (canRedeem && !isPolling) ? 'transparent' : 'var(--bg-secondary)',
            border: (canRedeem && !isPolling) ? '1px solid rgba(212, 165, 165, 0.3)' : 'none',
            color: (canRedeem && !isPolling) ? 'var(--rose-pink)' : 'var(--text-muted)',
            cursor: (canRedeem && !isPolling) ? 'pointer' : 'not-allowed',
            opacity: (canRedeem && !isPolling) ? 1 : 0.6
          }}
        >
          {isPolling ? (
            <span className="flex items-center justify-center">
              <span className="animate-spin mr-2">⏳</span>
              Awaiting Fulfillment...
            </span>
          ) : isSubmitting ? (
            <span className="flex items-center justify-center">
              <span className="animate-pulse mr-2">⚡</span>
              Redeeming...
            </span>
          ) : (
            'Redeem ROSE'
          )}
        </button>
      </div>
    </div>
  );
};

export default RedeemCard;
