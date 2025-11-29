import { useMemo } from 'react';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
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
      refetchInterval: 30000, // 30 seconds
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
      refetchInterval: 30000,
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
      };
    }

    const [rosePriceResult, vaultValueResult, breakdownResult, supplyResult] = vaultData;

    // rosePrice is in 6 decimals (USD)
    const rosePrice = rosePriceResult?.result
      ? Number(formatUnits(rosePriceResult.result, 6))
      : null;

    // vaultValueUSD is in 6 decimals
    const vaultValueUSD = vaultValueResult?.result
      ? Number(formatUnits(vaultValueResult.result, 6))
      : null;

    // getVaultBreakdown returns: btcValue, goldValue, usdcValue, roseValue, totalHardAssets, currentRosePrice, circulatingRose, rebalanceNeeded
    let breakdown = null;
    if (breakdownResult?.result) {
      const [btcValue, goldValue, usdcValue, roseValue, totalHardAssets] = breakdownResult.result;
      const hardAssetsTotal = Number(formatUnits(totalHardAssets, 6));
      const roseVal = Number(formatUnits(roseValue, 6));
      // Include ROSE in total so all percentages sum to 100%
      const totalIncludingRose = hardAssetsTotal + roseVal;

      breakdown = {
        btc: {
          value: Number(formatUnits(btcValue, 6)),
          percentage: totalIncludingRose > 0 ? (Number(formatUnits(btcValue, 6)) / totalIncludingRose) * 100 : 0,
        },
        gold: {
          value: Number(formatUnits(goldValue, 6)),
          percentage: totalIncludingRose > 0 ? (Number(formatUnits(goldValue, 6)) / totalIncludingRose) * 100 : 0,
        },
        usdc: {
          value: Number(formatUnits(usdcValue, 6)),
          percentage: totalIncludingRose > 0 ? (Number(formatUnits(usdcValue, 6)) / totalIncludingRose) * 100 : 0,
        },
        rose: {
          value: roseVal,
          percentage: totalIncludingRose > 0 ? (roseVal / totalIncludingRose) * 100 : 0,
        },
        total: totalIncludingRose,
      };
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
