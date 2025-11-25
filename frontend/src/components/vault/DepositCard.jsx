import React, { useState, useEffect, useMemo } from 'react';
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
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
  const [isApproving, setIsApproving] = useState(false);
  const [isDepositing, setIsDepositing] = useState(false);
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

  // Check if approval is needed
  const needsApproval = useMemo(() => {
    if (!usdcAllowanceRaw || amountInWei <= 0n) return false;
    return usdcAllowanceRaw < amountInWei;
  }, [usdcAllowanceRaw, amountInWei]);

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

  const handleApprove = async () => {
    if (!usdcAddress || !treasuryAddress) return;

    setIsApproving(true);
    setError('');

    try {
      const hash = await writeContractAsync({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [treasuryAddress, amountInWei],
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('Approval error:', err);
      if (err.message.includes('User rejected')) {
        setError('Transaction rejected');
      } else {
        setError('Approval failed. Please try again.');
      }
    } finally {
      setIsApproving(false);
    }
  };

  const handleDeposit = async () => {
    if (!treasuryAddress || amountInWei <= 0n) return;

    setIsDepositing(true);
    setError('');

    try {
      const hash = await writeContractAsync({
        address: treasuryAddress,
        abi: RoseTreasuryABI,
        functionName: 'deposit',
        args: [amountInWei],
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      setAmount('');
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('Deposit error:', err);
      if (err.message.includes('User rejected')) {
        setError('Transaction rejected');
      } else if (err.message.includes('execution reverted')) {
        const reason = err.message.split('execution reverted:')[1]?.split('"')[0]?.trim();
        setError(reason || 'Deposit failed');
      } else {
        setError('Deposit failed. Please try again.');
      }
    } finally {
      setIsDepositing(false);
    }
  };

  const isLoading = isApproving || isDepositing;
  const canDeposit = amountInWei > 0n && !validationError && !needsApproval && !isLoading;
  const canApprove = amountInWei > 0n && !validationError && needsApproval && !isLoading;

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">Deposit USDC</h3>

      <div className="space-y-4">
        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            USDC Amount
          </label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={isLoading}
              className="w-full px-3 py-2 pr-16 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground disabled:opacity-50"
            />
            <button
              onClick={handleMaxClick}
              disabled={isLoading || !usdcBalance}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50"
            >
              MAX
            </button>
          </div>
          {usdcBalance !== null && (
            <p className="text-xs text-foreground mt-1">
              Balance: {usdcBalance.toLocaleString()} USDC
            </p>
          )}
        </div>

        {/* Preview */}
        {amountInWei > 0n && (
          <div className="bg-muted/20 rounded-md p-3">
            <p className="text-sm text-foreground">You will receive:</p>
            <p className="text-lg font-semibold text-foreground">{roseToReceiveFormatted} ROSE</p>
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

        {/* Buttons */}
        <div className="space-y-2">
          {needsApproval && (
            <button
              onClick={handleApprove}
              disabled={!canApprove}
              className={`w-full py-3 px-4 rounded-md font-medium transition-colors ${
                canApprove
                  ? 'bg-secondary text-secondary-foreground hover:bg-secondary/90'
                  : 'bg-muted text-foreground cursor-not-allowed'
              }`}
            >
              {isApproving ? (
                <span className="flex items-center justify-center">
                  <span className="animate-pulse mr-2">...</span>
                  Approving USDC
                </span>
              ) : (
                'Approve USDC'
              )}
            </button>
          )}

          <button
            onClick={handleDeposit}
            disabled={!canDeposit}
            className={`w-full py-3 px-4 rounded-md font-medium transition-colors ${
              canDeposit
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-foreground cursor-not-allowed'
            }`}
          >
            {isDepositing ? (
              <span className="flex items-center justify-center">
                <span className="animate-pulse mr-2">...</span>
                Depositing
              </span>
            ) : needsApproval ? (
              'Deposit (Approval Required)'
            ) : (
              'Deposit'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DepositCard;
