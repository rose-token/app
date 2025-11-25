import React, { useState, useEffect } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { formatUnits, parseAbiItem } from 'viem';
import { Skeleton } from '../ui/skeleton';

const DEPOSITED_EVENT = parseAbiItem('event Deposited(address indexed user, uint256 usdcIn, uint256 roseMinted)');
const REDEEMED_EVENT = parseAbiItem('event Redeemed(address indexed user, uint256 roseBurned, uint256 usdcOut)');

const TransactionHistory = ({ treasuryAddress }) => {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchTransactions = async () => {
      if (!isConnected || !address || !treasuryAddress || !publicClient) {
        setTransactions([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Get current block number
        const currentBlock = await publicClient.getBlockNumber();
        // Look back ~7 days (assuming ~12 second blocks on Sepolia)
        const fromBlock = currentBlock - BigInt(50000);

        // Fetch deposit events
        const depositLogs = await publicClient.getLogs({
          address: treasuryAddress,
          event: DEPOSITED_EVENT,
          args: { user: address },
          fromBlock: fromBlock > 0n ? fromBlock : 0n,
          toBlock: 'latest',
        });

        // Fetch redeem events
        const redeemLogs = await publicClient.getLogs({
          address: treasuryAddress,
          event: REDEEMED_EVENT,
          args: { user: address },
          fromBlock: fromBlock > 0n ? fromBlock : 0n,
          toBlock: 'latest',
        });

        // Process and combine transactions
        const depositTxs = depositLogs.map((log) => ({
          type: 'Deposit',
          usdcAmount: Number(formatUnits(log.args.usdcIn, 6)),
          roseAmount: Number(formatUnits(log.args.roseMinted, 18)),
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
        }));

        const redeemTxs = redeemLogs.map((log) => ({
          type: 'Redeem',
          roseAmount: Number(formatUnits(log.args.roseBurned, 18)),
          usdcAmount: Number(formatUnits(log.args.usdcOut, 6)),
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
        }));

        // Combine and sort by block number (most recent first)
        const allTxs = [...depositTxs, ...redeemTxs]
          .sort((a, b) => Number(b.blockNumber - a.blockNumber))
          .slice(0, 10); // Limit to 10 most recent

        setTransactions(allTxs);
      } catch (err) {
        console.error('Error fetching transaction history:', err);
        setError('Failed to load transaction history');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTransactions();
  }, [address, isConnected, treasuryAddress, publicClient]);

  const shortenHash = (hash) => {
    if (!hash) return '';
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  };

  const getExplorerUrl = (hash) => {
    return `https://sepolia.etherscan.io/tx/${hash}`;
  };

  if (!isConnected) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">Transaction History</h3>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-4 text-foreground">
          <p>{error}</p>
        </div>
      ) : transactions.length === 0 ? (
        <div className="text-center py-8 text-foreground">
          <p>No transactions yet.</p>
          <p className="text-sm mt-1">Your deposit and redemption history will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {transactions.map((tx, index) => (
            <div
              key={`${tx.txHash}-${index}`}
              className="flex items-center justify-between p-3 bg-muted/10 rounded-md hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center space-x-3">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    tx.type === 'Deposit' ? 'bg-accent/20' : 'bg-secondary/20'
                  }`}
                >
                  {tx.type === 'Deposit' ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4 text-accent"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4 text-secondary"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium text-foreground">{tx.type}</p>
                  <p className="text-xs text-foreground">
                    {tx.type === 'Deposit'
                      ? `${tx.usdcAmount.toFixed(2)} USDC → ${tx.roseAmount.toFixed(4)} ROSE`
                      : `${tx.roseAmount.toFixed(4)} ROSE → ${tx.usdcAmount.toFixed(2)} USDC`}
                  </p>
                </div>
              </div>

              <a
                href={getExplorerUrl(tx.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:text-primary/80 hover:underline"
              >
                {shortenHash(tx.txHash)}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TransactionHistory;
