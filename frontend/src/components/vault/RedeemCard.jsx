import React, { useState, useMemo } from 'react';
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits, parseGwei } from 'viem';
import RoseTreasuryABI from '../../contracts/RoseTreasuryABI.json';
import RoseTokenABI from '../../contracts/RoseTokenABI.json';

const SEPOLIA_GAS_SETTINGS = {
  gas: 500_000n,
  maxFeePerGas: parseGwei('0.1'),
  maxPriorityFeePerGas: parseGwei('0.05'),
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
          abi: RoseTokenABI,
          functionName: 'approve',
          args: [treasuryAddress, amountInWei],
          ...SEPOLIA_GAS_SETTINGS,
        });

        console.log('✅ Approval transaction sent:', approveHash);
        console.log('⏳ Waiting for approval confirmation...');

        await publicClient.waitForTransactionReceipt({
          hash: approveHash,
          confirmations: 1,
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

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">Redeem ROSE</h3>

      <div className="space-y-4">
        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            ROSE Amount
          </label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={isSubmitting}
              className="w-full px-3 py-2 pr-16 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground disabled:opacity-50"
            />
            <button
              onClick={handleMaxClick}
              disabled={isSubmitting || !roseBalance}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50"
            >
              MAX
            </button>
          </div>
          {roseBalance !== null && (
            <p className="text-xs text-foreground mt-1">
              Balance: {roseBalance.toLocaleString()} ROSE
            </p>
          )}
        </div>

        {/* Preview */}
        {amountInWei > 0n && (
          <div className="bg-muted/20 rounded-md p-3">
            <p className="text-sm text-foreground">You will receive:</p>
            <p className="text-lg font-semibold text-foreground">{usdcToReceiveFormatted} USDC</p>
            {rosePrice && (
              <p className="text-xs text-foreground mt-1">
                Exchange rate: 1 ROSE = ${rosePrice.toFixed(4)}
              </p>
            )}
          </div>
        )}

        {/* Validation Error */}
        {validationError && (
          <p className="text-sm text-destructive">{validationError}</p>
        )}

        {/* Error */}
        {error && (
          <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
            {error}
          </div>
        )}

        {/* Button */}
        <button
          onClick={handleRedeem}
          disabled={!canRedeem}
          className={`w-full py-3 px-4 rounded-md font-medium transition-colors ${
            canRedeem
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-foreground cursor-not-allowed'
          }`}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center">
              <span className="animate-pulse mr-2">...</span>
              {needsApproval ? 'Approving & Redeeming...' : 'Redeeming...'}
            </span>
          ) : (
            'Redeem'
          )}
        </button>
      </div>
    </div>
  );
};

export default RedeemCard;
