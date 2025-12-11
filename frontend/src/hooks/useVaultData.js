import { useMemo } from 'react';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { formatUnits, hexToString } from 'viem';
import RoseTreasuryABI from '../contracts/RoseTreasuryABI.json';
import RoseTokenABI from '../contracts/RoseTokenABI.json';

// Standard ERC20 ABI for balanceOf and allowance
const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// Human-readable display names for asset keys
const ASSET_DISPLAY_NAMES = {
  BTC: 'Bitcoin',
  GOLD: 'Gold',
  STABLE: 'USDC',
  ROSE: 'ROSE',
};

// Convert bytes32 to string (remove null bytes)
function bytes32ToString(bytes32) {
  if (!bytes32) return '';
  try {
    const str = hexToString(bytes32, { size: 32 });
    return str.replace(/\0/g, '');
  } catch {
    return '';
  }
}

const useVaultData = () => {
  const { address, isConnected, chain } = useAccount();

  const treasuryAddress = import.meta.env.VITE_TREASURY_ADDRESS;
  const tokenAddress = import.meta.env.VITE_TOKEN_ADDRESS;

  // First, get the USDC address from the Treasury contract
  const { data: usdcAddress } = useReadContract({
    address: treasuryAddress,
    abi: RoseTreasuryABI,
    functionName: 'usdc',
    chainId: chain?.id,
    query: {
      enabled: !!treasuryAddress && isConnected,
    },
  });

  // Phase 1: Fetch basic vault data + getAllAssets to get the keys
  const vaultContracts = useMemo(() => {
    if (!treasuryAddress) return [];
    return [
      {
        address: treasuryAddress,
        abi: RoseTreasuryABI,
        functionName: 'rosePrice',
      },
      {
        address: treasuryAddress,
        abi: RoseTreasuryABI,
        functionName: 'hardAssetValueUSD',
      },
      {
        address: treasuryAddress,
        abi: RoseTreasuryABI,
        functionName: 'circulatingSupply',
      },
      {
        address: treasuryAddress,
        abi: RoseTreasuryABI,
        functionName: 'getAllAssets',
      },
      {
        address: treasuryAddress,
        abi: RoseTreasuryABI,
        functionName: 'needsRebalance',
      },
      {
        address: treasuryAddress,
        abi: RoseTreasuryABI,
        functionName: 'paused',
      },
    ];
  }, [treasuryAddress]);

  const {
    data: vaultData,
    isLoading: isLoadingVault,
    isError: isVaultError,
    refetch: refetchVault,
  } = useReadContracts({
    contracts: vaultContracts,
    allowSparse: true,
    query: {
      enabled: isConnected && vaultContracts.length > 0,
      refetchInterval: 45000,
    },
  });

  // Extract asset keys from getAllAssets result for Phase 2
  const assetKeys = useMemo(() => {
    if (!vaultData) return [];
    const allAssetsResult = vaultData[3]; // getAllAssets is at index 3
    if (!allAssetsResult?.result) return [];
    const [keys, assetList] = allAssetsResult.result;
    // Return only active asset keys
    return keys.filter((_, i) => assetList[i].active);
  }, [vaultData]);

  // Phase 2: Fetch getAssetBreakdown for each asset key
  const assetBreakdownContracts = useMemo(() => {
    if (!treasuryAddress || assetKeys.length === 0) return [];
    return assetKeys.map(keyBytes32 => ({
      address: treasuryAddress,
      abi: RoseTreasuryABI,
      functionName: 'getAssetBreakdown',
      args: [keyBytes32],
    }));
  }, [treasuryAddress, assetKeys]);

  const {
    data: assetBreakdownData,
    isLoading: isLoadingAssets,
    refetch: refetchAssets,
  } = useReadContracts({
    contracts: assetBreakdownContracts,
    allowSparse: true,
    query: {
      enabled: isConnected && assetBreakdownContracts.length > 0,
      refetchInterval: 45000,
    },
  });

  // User balance contracts
  const userContracts = useMemo(() => {
    if (!address || !tokenAddress || !usdcAddress || !treasuryAddress) return [];
    return [
      {
        address: tokenAddress,
        abi: RoseTokenABI,
        functionName: 'balanceOf',
        args: [address],
      },
      {
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      },
      {
        address: tokenAddress,
        abi: RoseTokenABI,
        functionName: 'allowance',
        args: [address, treasuryAddress],
      },
      {
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, treasuryAddress],
      },
      // Phase 5: Hybrid redemption - check for pending redemption
      {
        address: treasuryAddress,
        abi: RoseTreasuryABI,
        functionName: 'getUserPendingRedemption',
        args: [address],
      },
    ];
  }, [address, tokenAddress, usdcAddress, treasuryAddress]);

  const {
    data: userData,
    isLoading: isLoadingUser,
    refetch: refetchUser,
  } = useReadContracts({
    contracts: userContracts,
    allowSparse: true,
    query: {
      enabled: isConnected && userContracts.length > 0,
      refetchInterval: 45000,
    },
  });

  // Process vault data with real asset breakdowns
  const processedVaultData = useMemo(() => {
    if (!vaultData) {
      return {
        rosePrice: null,
        vaultValueUSD: null,
        breakdown: null,
        circulatingSupply: null,
        assets: null,
        needsRebalance: false,
        isPaused: false,
      };
    }

    const [
      rosePriceResult,
      vaultValueResult,
      supplyResult,
      allAssetsResult,
      needsRebalanceResult,
      pausedResult,
    ] = vaultData;

    // rosePrice is in 6 decimals (USD)
    const rosePrice = rosePriceResult?.result
      ? Number(formatUnits(rosePriceResult.result, 6))
      : null;

    // vaultValueUSD is in 6 decimals
    const vaultValueUSD = vaultValueResult?.result
      ? Number(formatUnits(vaultValueResult.result, 6))
      : null;

    // needsRebalance boolean
    const needsRebalance = needsRebalanceResult?.result ?? false;

    // paused boolean
    const isPaused = pausedResult?.result ?? false;

    // circulatingSupply is in 18 decimals (ROSE)
    const circulatingSupply = supplyResult?.result
      ? Number(formatUnits(supplyResult.result, 18))
      : null;

    // Process asset breakdowns from getAssetBreakdown calls
    let assets = null;
    let breakdown = null;

    if (allAssetsResult?.result && assetBreakdownData && assetBreakdownData.length > 0) {
      const [keys, assetList] = allAssetsResult.result;

      // Build assets array with real values from getAssetBreakdown
      let totalValueUSD = 0;
      const activeAssets = [];

      // Match asset keys with their breakdown data
      let breakdownIndex = 0;
      for (let i = 0; i < keys.length; i++) {
        const asset = assetList[i];
        if (!asset.active) continue;

        const keyBytes32 = keys[i];
        const key = bytes32ToString(keyBytes32);
        const breakdownResult = assetBreakdownData[breakdownIndex];
        breakdownIndex++;

        if (breakdownResult?.result) {
          // getAssetBreakdown returns: token, balance, valueUSD, targetBps, actualBps, active
          const [token, balance, valueUSD, targetBps, actualBps, active] = breakdownResult.result;
          const valueUSDNum = Number(formatUnits(valueUSD, 6));
          totalValueUSD += valueUSDNum;

          activeAssets.push({
            key,
            keyBytes32,
            displayName: ASSET_DISPLAY_NAMES[key] || key,
            token,
            balance: balance.toString(),
            valueUSD: valueUSDNum,
            targetBps: Number(targetBps),
            actualBps: Number(actualBps),
            active,
          });
        }
      }

      assets = activeAssets;

      // Build breakdown with real percentages and drift
      if (activeAssets.length > 0 && totalValueUSD > 0) {
        const assetsWithPercentages = activeAssets.map(asset => {
          const percentage = (asset.valueUSD / totalValueUSD) * 100;
          const targetPercentage = asset.targetBps / 100;
          const driftBps = Math.abs(asset.actualBps - asset.targetBps);

          return {
            key: asset.key,
            displayName: asset.displayName,
            value: asset.valueUSD,
            percentage,
            targetBps: asset.targetBps,
            targetPercentage,
            actualBps: asset.actualBps,
            driftBps,
          };
        });

        // Build legacy structure for backwards compatibility
        const legacyBreakdown = {};
        for (const asset of assetsWithPercentages) {
          const legacyKey = asset.key === 'STABLE' ? 'usdc' :
                           asset.key === 'GOLD' ? 'gold' :
                           asset.key === 'BTC' ? 'btc' :
                           asset.key === 'ROSE' ? 'rose' : null;
          if (legacyKey) {
            legacyBreakdown[legacyKey] = {
              value: asset.value,
              percentage: asset.percentage,
            };
          }
        }

        breakdown = {
          assets: assetsWithPercentages,
          total: totalValueUSD,
          // Legacy structure
          btc: legacyBreakdown.btc || { value: 0, percentage: 0 },
          gold: legacyBreakdown.gold || { value: 0, percentage: 0 },
          usdc: legacyBreakdown.usdc || { value: 0, percentage: 0 },
          rose: legacyBreakdown.rose || { value: 0, percentage: 0 },
        };
      }
    }

    return {
      rosePrice,
      vaultValueUSD,
      breakdown,
      circulatingSupply,
      assets,
      needsRebalance,
      isPaused,
    };
  }, [vaultData, assetBreakdownData]);

  // Process user data
  const processedUserData = useMemo(() => {
    if (!userData) {
      return {
        roseBalance: null,
        usdcBalance: null,
        roseAllowance: null,
        usdcAllowance: null,
        pendingRedemptionId: null,
      };
    }

    const [
      roseBalanceResult,
      usdcBalanceResult,
      roseAllowanceResult,
      usdcAllowanceResult,
      pendingRedemptionResult,
    ] = userData;

    // Phase 5: Pending redemption ID (0 means no pending)
    const pendingRedemptionId = pendingRedemptionResult?.result
      ? (pendingRedemptionResult.result > 0n ? pendingRedemptionResult.result.toString() : null)
      : null;

    return {
      roseBalance: roseBalanceResult?.result
        ? Number(formatUnits(roseBalanceResult.result, 18))
        : null,
      roseBalanceRaw: roseBalanceResult?.result || 0n,
      usdcBalance: usdcBalanceResult?.result
        ? Number(formatUnits(usdcBalanceResult.result, 6))
        : null,
      usdcBalanceRaw: usdcBalanceResult?.result || 0n,
      roseAllowance: roseAllowanceResult?.result
        ? Number(formatUnits(roseAllowanceResult.result, 18))
        : null,
      roseAllowanceRaw: roseAllowanceResult?.result || 0n,
      usdcAllowance: usdcAllowanceResult?.result
        ? Number(formatUnits(usdcAllowanceResult.result, 6))
        : null,
      usdcAllowanceRaw: usdcAllowanceResult?.result || 0n,
      pendingRedemptionId,
    };
  }, [userData]);

  const refetch = () => {
    refetchVault();
    refetchAssets();
    refetchUser();
  };

  return {
    // Vault data
    ...processedVaultData,
    // User data
    ...processedUserData,
    // Addresses
    treasuryAddress,
    tokenAddress,
    usdcAddress,
    // Status
    isLoading: isLoadingVault || isLoadingAssets || isLoadingUser,
    isError: isVaultError,
    isConnected,
    // Actions
    refetch,
  };
};

export default useVaultData;
