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

const DepositCard = ({
  usdcBalance,
  usdcBalanceRaw,
  usdcAllowance,
  usdcAllowanceRaw,
  rosePrice,
  treasuryAddress,
  usdcAddress,
  onSuccess,
}) => {
  const { chain, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Calculate ROSE amount to receive
  const amountInWei = useMemo(() => {
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return 0n;
    try {
      return parseUnits(amount, 6); // USDC has 6 decimals
    } catch {
      return 0n;
    }
  }, [amount]);

  // Fetch preview of ROSE to receive
  const { data: roseToReceive } = useReadContract({
    address: treasuryAddress,
    abi: RoseTreasuryABI,
    functionName: 'calculateRoseForDeposit',
    args: [amountInWei],
    chainId: chain?.id,
    query: {
      enabled: amountInWei > 0n && !!treasuryAddress,
    },
  });

  const roseToReceiveFormatted = useMemo(() => {
    if (!roseToReceive) return '0.00';
    return Number(formatUnits(roseToReceive, 18)).toFixed(4);
  }, [roseToReceive]);

  // Always require approval for deposits (simpler and more reliable)
  const needsApproval = amountInWei > 0n;

  // Validation
  const validationError = useMemo(() => {
    if (!amount || parseFloat(amount) <= 0) return null;
    if (usdcBalance !== null && parseFloat(amount) > usdcBalance) {
      return 'Insufficient USDC balance';
    }
    return null;
  }, [amount, usdcBalance]);

  const handleMaxClick = () => {
    if (usdcBalance !== null) {
      setAmount(usdcBalance.toString());
    }
  };

  const handleDeposit = async () => {
    if (!usdcAddress || !treasuryAddress || amountInWei <= 0n) return;

    // Validate balance before submitting transaction
    if (usdcBalanceRaw !== undefined && amountInWei > usdcBalanceRaw) {
      setError('Insufficient USDC balance');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      // Step 1: Approve if needed
      if (needsApproval) {
        console.log('⛽ Approving USDC transfer...');
        const approveHash = await writeContractAsync({
          address: usdcAddress,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [treasuryAddress, amountInWei],
          ...SEPOLIA_GAS_SETTINGS,
        });

        console.log('✅ Approval transaction sent:', approveHash);
        console.log('⏳ Waiting for approval confirmation...');

        await new Promise(resolve => setTimeout(resolve, 800));
      }
      // Step 2: Deposit
      console.log('⛽ Depositing USDC...');
      const depositHash = await writeContractAsync({
        address: treasuryAddress,
        abi: RoseTreasuryABI,
        functionName: 'deposit',
        args: [amountInWei],
        ...SEPOLIA_GAS_SETTINGS,
      });

      console.log('✅ Deposit transaction sent:', depositHash);
      console.log('⏳ Waiting for deposit confirmation...');

      await publicClient.waitForTransactionReceipt({
        hash: depositHash,
        confirmations: 1,
      });

      console.log('🎉 Deposit completed successfully!');
      setAmount('');
      setIsSubmitting(false);
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('❌ Deposit error:', err);
      if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
        setError('Transaction rejected. Please approve the transaction to continue.');
      } else if (err.message.includes('InsufficientBalance')) {
        setError('Insufficient USDC balance');
      } else if (err.message.includes('execution reverted')) {
        const reason = err.message.split('execution reverted:')[1]?.split('"')[0]?.trim();
        setError(reason || 'Deposit failed');
      } else {
        setError('Deposit failed. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const canDeposit = amountInWei > 0n && !validationError && !isSubmitting;

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
        Deposit USDC
      </h3>

      <div className="space-y-4">
        {/* Amount Input */}
        <div>
          <label style={labelStyle}>
            USDC Amount
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
              disabled={isSubmitting || !usdcBalance}
              className="absolute right-3 top-1/2 -translate-y-1/2 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors disabled:opacity-50"
              style={{ color: 'var(--rose-gold)', background: 'rgba(212, 175, 140, 0.1)' }}
            >
              MAX
            </button>
          </div>
          {usdcBalance !== null && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              Balance: {usdcBalance.toLocaleString()} USDC
            </p>
          )}
        </div>

        {/* Preview */}
        {amountInWei > 0n && (
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--success-bg)', border: '1px solid rgba(74, 222, 128, 0.3)' }}
          >
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>You will receive:</p>
            <p className="font-display text-xl font-semibold" style={{ color: 'var(--success)' }}>{roseToReceiveFormatted} ROSE</p>
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
          onClick={handleDeposit}
          disabled={!canDeposit}
          className="w-full py-3.5 px-6 rounded-xl font-semibold text-sm transition-all duration-300"
          style={{
            background: canDeposit
              ? 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)'
              : 'var(--bg-secondary)',
            color: canDeposit ? 'var(--bg-primary)' : 'var(--text-muted)',
            boxShadow: canDeposit ? '0 4px 16px rgba(212, 165, 165, 0.3)' : 'none',
            cursor: canDeposit ? 'pointer' : 'not-allowed',
            opacity: canDeposit ? 1 : 0.6
          }}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center">
              <span className="animate-pulse mr-2">⚡</span>
              Depositing...
            </span>
          ) : (
            'Deposit USDC'
          )}
        </button>
      </div>
    </div>
  );
};

export default DepositCard;
