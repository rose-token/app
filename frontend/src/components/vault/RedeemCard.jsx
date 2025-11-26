import React, { useState, useMemo } from 'react';
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits, parseGwei } from 'viem';
import RoseTreasuryABI from '../../contracts/RoseTreasuryABI.json';

// Standard ERC20 ABI for approve
const ERC20_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

const SEPOLIA_GAS_SETTINGS = {
  gas: 500_000n,
  maxFeePerGas: parseGwei('4'),
  maxPriorityFeePerGas: parseGwei('2'),
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
}) => {
  const { chain } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

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
      // Step 1: Approve if needed
      if (needsApproval) {
        console.log('⛽ Approving ROSE transfer...');
        const approveHash = await writeContractAsync({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [treasuryAddress, amountInWei],
          ...SEPOLIA_GAS_SETTINGS,
        });

        console.log('✅ Approval transaction sent:', approveHash);
        console.log('⏳ Waiting for approval confirmation...');

        await publicClient.waitForTransactionReceipt({
          hash: approveHash,
          confirmations: 1
        });
      }

      // Step 2: Redeem
      console.log('⛽ Redeeming ROSE...');
      const redeemHash = await writeContractAsync({
        address: treasuryAddress,
        abi: RoseTreasuryABI,
        functionName: 'redeem',
        args: [amountInWei],
        ...SEPOLIA_GAS_SETTINGS,
      });

      console.log('✅ Redeem transaction sent:', redeemHash);
      console.log('⏳ Waiting for redeem confirmation...');

      await publicClient.waitForTransactionReceipt({
        hash: redeemHash,
        confirmations: 1,
      });

      console.log('🎉 Redemption completed successfully!');
      setAmount('');
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('❌ Redeem error:', err);
      if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
        setError('Transaction rejected. Please approve the transaction to continue.');
      } else if (err.message.includes('InsufficientBalance')) {
        setError('Insufficient ROSE balance');
      } else if (err.message.includes('InsufficientLiquidity')) {
        setError('Insufficient liquidity in vault');
      } else if (err.message.includes('execution reverted')) {
        const reason = err.message.split('execution reverted:')[1]?.split('"')[0]?.trim();
        setError(reason || 'Redemption failed');
      } else {
        setError('Redemption failed. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const canRedeem = amountInWei > 0n && !validationError && !isSubmitting;

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
      <h3 className="font-display text-xl font-medium mb-5" style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
        Redeem ROSE
      </h3>

      <div className="space-y-4">
        {/* Amount Input */}
        <div>
          <label style={labelStyle}>
            ROSE Amount
          </label>
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

        {/* Button */}
        <button
          onClick={handleRedeem}
          disabled={!canRedeem}
          className="w-full py-3.5 px-6 rounded-xl font-semibold text-sm transition-all duration-300"
          style={{
            background: canRedeem ? 'transparent' : 'var(--bg-secondary)',
            border: canRedeem ? '1px solid rgba(212, 165, 165, 0.3)' : 'none',
            color: canRedeem ? 'var(--rose-pink)' : 'var(--text-muted)',
            cursor: canRedeem ? 'pointer' : 'not-allowed',
            opacity: canRedeem ? 1 : 0.6
          }}
        >
          {isSubmitting ? (
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
