import { useMemo, useState, useEffect, useCallback } from 'react';
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
    // hexToString handles the conversion but may include null chars
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

  // Batch read vault data
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
        functionName: 'getVaultBreakdown',
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
      refetchInterval: 45000, // 45 seconds
    },
  });

  // User balance contracts
  const userContracts = useMemo(() => {
    if (!address || !tokenAddress || !usdcAddress || !treasuryAddress) return [];
    return [
      // ROSE balance
      {
        address: tokenAddress,
        abi: RoseTokenABI,
        functionName: 'balanceOf',
        args: [address],
      },
      // USDC balance
      {
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      },
      // ROSE allowance for Treasury
      {
        address: tokenAddress,
        abi: RoseTokenABI,
        functionName: 'allowance',
        args: [address, treasuryAddress],
      },
      // USDC allowance for Treasury
      {
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, treasuryAddress],
      },
      // Cooldown: time until deposit allowed
      {
        address: treasuryAddress,
        abi: RoseTreasuryABI,
        functionName: 'timeUntilDeposit',
        args: [address],
      },
      // Cooldown: time until redeem allowed
      {
        address: treasuryAddress,
        abi: RoseTreasuryABI,
        functionName: 'timeUntilRedeem',
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
      refetchInterval: 45000, // 45 seconds
    },
  });

  // Process vault data
  const processedVaultData = useMemo(() => {
    if (!vaultData) {
      return {
        rosePrice: null,
        vaultValueUSD: null,
        breakdown: null,
        circulatingSupply: null,
        assets: null,
        needsRebalance: false,
      };
    }

    const [
      rosePriceResult,
      vaultValueResult,
      breakdownResult,
      supplyResult,
      allAssetsResult,
      needsRebalanceResult,
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

    // Process getAllAssets for dynamic asset display
    let assets = null;
    if (allAssetsResult?.result) {
      const [keys, assetList] = allAssetsResult.result;
      assets = keys.map((keyBytes32, i) => {
        const key = bytes32ToString(keyBytes32);
        const asset = assetList[i];
        return {
          key,
          keyBytes32,
          displayName: ASSET_DISPLAY_NAMES[key] || key,
          token: asset.token,
          priceFeed: asset.priceFeed,
          decimals: Number(asset.decimals),
          targetBps: Number(asset.targetBps),
          active: asset.active,
        };
      }).filter(a => a.active); // Only show active assets
    }

    // getVaultBreakdown returns: btcValue, goldValue, usdcValue, roseValue, totalHardAssets, currentRosePrice, circulatingRose, rebalanceNeeded
    // For backwards compatibility, keep the old structure but also build dynamic one
    let breakdown = null;
    if (breakdownResult?.result) {
      const [btcValue, goldValue, usdcValue, roseValue, totalHardAssets] = breakdownResult.result;
      const hardAssetsTotal = Number(formatUnits(totalHardAssets, 6));
      const roseVal = Number(formatUnits(roseValue, 6));
      // Include ROSE in total so all percentages sum to 100%
      const totalIncludingRose = hardAssetsTotal + roseVal;

      // Build dynamic breakdown from asset values
      // Map legacy breakdown values to asset keys for now
      const assetValues = {
        BTC: Number(formatUnits(btcValue, 6)),
        GOLD: Number(formatUnits(goldValue, 6)),
        STABLE: Number(formatUnits(usdcValue, 6)),
        ROSE: roseVal,
      };

      // If we have dynamic assets, use them to build breakdown
      if (assets && assets.length > 0) {
        breakdown = {
          assets: assets.map(asset => {
            const value = assetValues[asset.key] ?? 0;
            const percentage = totalIncludingRose > 0 ? (value / totalIncludingRose) * 100 : 0;
            const targetPercentage = asset.targetBps / 100; // Convert bps to percentage
            return {
              key: asset.key,
              displayName: asset.displayName,
              value,
              percentage,
              targetBps: asset.targetBps,
              targetPercentage,
              // Calculate drift (difference from target)
              driftBps: Math.abs(Math.round(percentage * 100) - asset.targetBps),
            };
          }),
          total: totalIncludingRose,
          // Keep legacy structure for backwards compatibility
          btc: {
            value: assetValues.BTC,
            percentage: totalIncludingRose > 0 ? (assetValues.BTC / totalIncludingRose) * 100 : 0,
          },
          gold: {
            value: assetValues.GOLD,
            percentage: totalIncludingRose > 0 ? (assetValues.GOLD / totalIncludingRose) * 100 : 0,
          },
          usdc: {
            value: assetValues.STABLE,
            percentage: totalIncludingRose > 0 ? (assetValues.STABLE / totalIncludingRose) * 100 : 0,
          },
          rose: {
            value: roseVal,
            percentage: totalIncludingRose > 0 ? (roseVal / totalIncludingRose) * 100 : 0,
          },
        };
      } else {
        // Fallback to legacy structure if no dynamic assets
        breakdown = {
          btc: {
            value: assetValues.BTC,
            percentage: totalIncludingRose > 0 ? (assetValues.BTC / totalIncludingRose) * 100 : 0,
          },
          gold: {
            value: assetValues.GOLD,
            percentage: totalIncludingRose > 0 ? (assetValues.GOLD / totalIncludingRose) * 100 : 0,
          },
          usdc: {
            value: assetValues.STABLE,
            percentage: totalIncludingRose > 0 ? (assetValues.STABLE / totalIncludingRose) * 100 : 0,
          },
          rose: {
            value: roseVal,
            percentage: totalIncludingRose > 0 ? (roseVal / totalIncludingRose) * 100 : 0,
          },
          total: totalIncludingRose,
        };
      }
    }

    // circulatingSupply is in 18 decimals (ROSE)
    const circulatingSupply = supplyResult?.result
      ? Number(formatUnits(supplyResult.result, 18))
      : null;

    return {
      rosePrice,
      vaultValueUSD,
      breakdown,
      circulatingSupply,
      assets,
      needsRebalance,
    };
  }, [vaultData]);

  // Process user data
  const processedUserData = useMemo(() => {
    if (!userData) {
      return {
        roseBalance: null,
        usdcBalance: null,
        roseAllowance: null,
        usdcAllowance: null,
        depositCooldown: 0,
        redeemCooldown: 0,
      };
    }

    const [
      roseBalanceResult,
      usdcBalanceResult,
      roseAllowanceResult,
      usdcAllowanceResult,
      depositCooldownResult,
      redeemCooldownResult,
    ] = userData;

    return {
      // ROSE has 18 decimals
      roseBalance: roseBalanceResult?.result
        ? Number(formatUnits(roseBalanceResult.result, 18))
        : null,
      roseBalanceRaw: roseBalanceResult?.result || 0n,
      // USDC has 6 decimals
      usdcBalance: usdcBalanceResult?.result
        ? Number(formatUnits(usdcBalanceResult.result, 6))
        : null,
      usdcBalanceRaw: usdcBalanceResult?.result || 0n,
      // Allowances
      roseAllowance: roseAllowanceResult?.result
        ? Number(formatUnits(roseAllowanceResult.result, 18))
        : null,
      roseAllowanceRaw: roseAllowanceResult?.result || 0n,
      usdcAllowance: usdcAllowanceResult?.result
        ? Number(formatUnits(usdcAllowanceResult.result, 6))
        : null,
      usdcAllowanceRaw: usdcAllowanceResult?.result || 0n,
      // Cooldowns (in seconds)
      depositCooldown: depositCooldownResult?.result
        ? Number(depositCooldownResult.result)
        : 0,
      redeemCooldown: redeemCooldownResult?.result
        ? Number(redeemCooldownResult.result)
        : 0,
    };
  }, [userData]);

  const refetch = () => {
    refetchVault();
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
    isLoading: isLoadingVault || isLoadingUser,
    isError: isVaultError,
    isConnected,
    // Actions
    refetch,
  };
};

export default useVaultData;
