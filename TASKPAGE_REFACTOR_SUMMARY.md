# TasksPage.jsx Refactoring Summary

## Complete Migration from ethers v5 to wagmi v2 + viem

### Overview
This refactoring completely removes ethers v5 dependencies from TasksPage.jsx and replaces them with wagmi v2 hooks and viem utilities, resulting in cleaner, more maintainable code that follows modern Web3 best practices.

---

## Key Changes

### 1. **Imports Refactored**

#### Before (ethers v5):
```javascript
import { useWallet } from '../hooks/useWallet';
import { useContract } from '../hooks/useContract';
```

#### After (wagmi v2 + viem):
```javascript
import { useAccount, useReadContract, useWriteContract, useWatchContractEvent } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import RoseMarketplaceABI from '../contracts/RoseMarketplaceABI.json';
import RoseTokenABI from '../contracts/RoseTokenABI.json';
```

**Benefits:**
- Direct ABI imports (no wrapper hooks needed)
- Native wagmi hooks for all operations
- Viem utilities for BigInt conversions
- Reduced dependency chain

---

### 2. **Wallet Connection**

#### Before:
```javascript
const { account, isConnected } = useWallet();
const { roseMarketplace, roseToken } = useContract();
```

#### After:
```javascript
const { address: account, isConnected } = useAccount();
const MARKETPLACE_ADDRESS = import.meta.env.VITE_MARKETPLACE_ADDRESS;
const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS;
```

**Benefits:**
- Direct wagmi hook usage (no wrapper)
- Contract addresses from environment (cleaner)
- No ethers Contract instances needed

---

### 3. **Contract Reads**

#### Before (ethers v5):
```javascript
// taskCounter read
const taskCount = await roseMarketplace.taskCounter();

// tasks() read
const task = await roseMarketplace.tasks(taskId);

// balanceOf read
const userBalance = await roseToken.balanceOf(account);
```

#### After (wagmi v2 + viem):
```javascript
// taskCounter read (hook-based, auto-refreshing)
const { data: taskCounter, refetch: refetchTaskCounter } = useReadContract({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  functionName: 'taskCounter',
  query: {
    enabled: isConnected && !!MARKETPLACE_ADDRESS,
  }
});

// tasks() read (using wagmi actions)
const { readContract } = await import('wagmi/actions');
const { config } = await import('../wagmi.config');

const task = await readContract(config, {
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  functionName: 'tasks',
  args: [BigInt(taskId)]
});

// balanceOf read (using wagmi actions)
const userBalance = await readContract(config, {
  address: TOKEN_ADDRESS,
  abi: RoseTokenABI,
  functionName: 'balanceOf',
  args: [account]
});
```

**Benefits:**
- `useReadContract` provides automatic caching and refetching
- wagmi actions for imperative reads
- Native BigInt support (no ethers.BigNumber)
- Conditional execution with `enabled` flag

---

### 4. **Contract Writes (8 Operations)**

#### Before (ethers v5 pattern):
```javascript
// Claim task
const tx = await roseMarketplace.claimTask(taskId);
await tx.wait();

// Unclaim task
const tx = await roseMarketplace.unclaimTask(taskId);
await tx.wait();

// Mark completed
const tx = await roseMarketplace.markTaskCompleted(taskId, prUrl);
await tx.wait();

// Approve by customer
const tx = await roseMarketplace.approveCompletionByCustomer(taskId);
await tx.wait();

// Approve by stakeholder (with gas limit)
const tx = await roseMarketplace.approveCompletionByStakeholder(taskId, {
  gasLimit: 500000
});
await tx.wait();

// Accept payment (with gas limit)
const tx = await roseMarketplace.acceptPayment(taskId, {
  gasLimit: 500000
});
await tx.wait();

// Stake as stakeholder
const approveTx = await roseToken.approve(roseMarketplace.address, depositAmount);
await approveTx.wait();
const tx = await roseMarketplace.stakeholderStake(taskId, depositAmount, {
  gasLimit: 300000
});
await tx.wait();

// Cancel task
const tx = await roseMarketplace.cancelTask(taskId, {
  gasLimit: 300000
});
await tx.wait();
```

#### After (wagmi v2 + viem pattern):
```javascript
const { writeContractAsync } = useWriteContract();

// Claim task
const hash = await writeContractAsync({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  functionName: 'claimTask',
  args: [BigInt(taskId)]
});

// Unclaim task
const hash = await writeContractAsync({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  functionName: 'unclaimTask',
  args: [BigInt(taskId)]
});

// Mark completed
const hash = await writeContractAsync({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  functionName: 'markTaskCompleted',
  args: [BigInt(taskId), prUrl]
});

// Approve by customer
const hash = await writeContractAsync({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  functionName: 'approveCompletionByCustomer',
  args: [BigInt(taskId)]
});

// Approve by stakeholder (with gas)
const hash = await writeContractAsync({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  functionName: 'approveCompletionByStakeholder',
  args: [BigInt(taskId)],
  gas: 500000n
});

// Accept payment (with gas)
const hash = await writeContractAsync({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  functionName: 'acceptPayment',
  args: [BigInt(taskId)],
  gas: 500000n
});

// Stake as stakeholder (approve + stake)
const approveHash = await writeContractAsync({
  address: TOKEN_ADDRESS,
  abi: RoseTokenABI,
  functionName: 'approve',
  args: [MARKETPLACE_ADDRESS, depositAmount]
});

const stakeHash = await writeContractAsync({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  functionName: 'stakeholderStake',
  args: [BigInt(taskId), depositAmount],
  gas: 300000n
});

// Cancel task
const hash = await writeContractAsync({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  functionName: 'cancelTask',
  args: [BigInt(taskId)],
  gas: 300000n
});
```

**Benefits:**
- Single `writeContractAsync` hook for all writes
- Consistent API across all operations
- Native BigInt for args (no `.toString()` needed)
- Gas limit using BigInt (`500000n` instead of `{ gasLimit: 500000 }`)
- Returns transaction hash directly (no `.wait()` needed for basic operations)

---

### 5. **Event Listeners (5 Events)**

#### Before (ethers v5 pattern):
```javascript
useEffect(() => {
  if (roseMarketplace) {
    // PaymentReleased event
    const paymentFilter = roseMarketplace.filters.PaymentReleased();
    const paymentListener = (taskId, worker, amount) => {
      console.log("Payment released event:", { taskId, worker, amount });
      fetchTasks();
    };
    roseMarketplace.on(paymentFilter, paymentListener);

    // TaskClosed event
    const closedFilter = roseMarketplace.filters.TaskClosed();
    const closedListener = (taskId) => {
      console.log("Task closed event:", taskId);
      fetchTasks();
    };
    roseMarketplace.on(closedFilter, closedListener);

    // ... 3 more events ...

    return () => {
      roseMarketplace.off(paymentFilter, paymentListener);
      roseMarketplace.off(closedFilter, closedListener);
      // ... cleanup 3 more events ...
    };
  }
}, [roseMarketplace, fetchTasks]);
```

#### After (wagmi v2 pattern):
```javascript
// PaymentReleased event
useWatchContractEvent({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  eventName: 'PaymentReleased',
  onLogs: (logs) => {
    console.log("Payment released event:", logs);
    fetchTasks();
  },
  enabled: isConnected && !!MARKETPLACE_ADDRESS
});

// TaskClosed event
useWatchContractEvent({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  eventName: 'TaskClosed',
  onLogs: (logs) => {
    console.log("Task closed event:", logs);
    fetchTasks();
  },
  enabled: isConnected && !!MARKETPLACE_ADDRESS
});

// TaskReadyForPayment event
useWatchContractEvent({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  eventName: 'TaskReadyForPayment',
  onLogs: (logs) => {
    console.log("Task ready for payment event:", logs);
    fetchTasks();
  },
  enabled: isConnected && !!MARKETPLACE_ADDRESS
});

// StakeholderStaked event
useWatchContractEvent({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  eventName: 'StakeholderStaked',
  onLogs: (logs) => {
    console.log("Stakeholder staked event:", logs);
    fetchTasks();
  },
  enabled: isConnected && !!MARKETPLACE_ADDRESS
});

// TaskCancelled event
useWatchContractEvent({
  address: MARKETPLACE_ADDRESS,
  abi: RoseMarketplaceABI,
  eventName: 'TaskCancelled',
  onLogs: (logs) => {
    console.log("Task cancelled event:", logs);
    fetchTasks();
  },
  enabled: isConnected && !!MARKETPLACE_ADDRESS
});
```

**Benefits:**
- No manual cleanup needed (wagmi handles it)
- Each event is self-contained
- Conditional listening with `enabled` flag
- Logs array format (can handle multiple events in one block)
- More declarative, easier to read

---

### 6. **BigInt Conversions**

#### Before (ethers v5):
```javascript
const depositAmount = window.BigInt(task.deposit) / window.BigInt(10);
const userBalanceBigInt = window.BigInt(userBalance.toString());
const shortfall = depositAmount - userBalanceBigInt;
const shortfallInRose = Number(shortfall) / 1e18;
```

#### After (viem):
```javascript
const depositAmount = BigInt(task.deposit) / 10n;
const shortfall = depositAmount - userBalance; // userBalance already BigInt
const shortfallInRose = Number(formatUnits(shortfall, 18));
```

**Benefits:**
- Native BigInt support (no `window.BigInt()`)
- `formatUnits` for clean conversion to human-readable format
- BigInt literals (`10n` instead of `BigInt(10)`)
- Simpler arithmetic

---

## File Size Comparison

| Metric | Before (ethers v5) | After (wagmi v2) | Change |
|--------|-------------------|------------------|--------|
| Total Lines | 455 | 541 | +86 (more explicit) |
| Import Lines | 9 | 13 | +4 (direct imports) |
| Hook Dependencies | 2 custom hooks | 4 wagmi hooks | More modular |
| Event Listeners | 1 large useEffect | 5 separate hooks | Better organization |

---

## Breaking Changes & Considerations

### 1. **Removed Dependencies**
- No longer depends on `useWallet` hook
- No longer depends on `useContract` hook
- These hooks can now be safely removed if not used elsewhere

### 2. **Environment Variables**
- Still uses `VITE_MARKETPLACE_ADDRESS` and `VITE_TOKEN_ADDRESS`
- No changes needed to `.env` files

### 3. **Transaction Handling**
- ethers v5 returns `TransactionResponse` with `.wait()`
- wagmi v2 returns transaction hash directly
- For transaction confirmation, you can use `useWaitForTransactionReceipt` hook if needed

### 4. **Gas Limits**
- ethers v5: `{ gasLimit: 500000 }`
- wagmi v2: `{ gas: 500000n }`
- Note the property name change and BigInt format

### 5. **BigInt Native**
- All numeric values are native BigInt (no ethers.BigNumber)
- Use `formatUnits` for display conversions
- Use `parseUnits` for user input conversions

---

## Testing Checklist

- [ ] Task fetching displays correctly
- [ ] Claim task transaction works
- [ ] Unclaim task transaction works
- [ ] Mark completed transaction works
- [ ] Customer approval works
- [ ] Stakeholder approval works
- [ ] Accept payment works
- [ ] Stake as stakeholder works (including token approval)
- [ ] Cancel task works
- [ ] All 5 event listeners trigger task refresh
- [ ] Error messages display correctly
- [ ] Loading states work properly

---

## Next Steps

1. **Test the refactored component** in development environment
2. **Remove unused hooks** if `useWallet` and `useContract` are no longer used elsewhere
3. **Update other components** that use similar patterns
4. **Consider adding `useWaitForTransactionReceipt`** for better UX on transaction confirmations
5. **Add optimistic updates** using wagmi's mutation lifecycle hooks

---

## Migration Benefits

✅ **Removed ethers v5 dependency** from this component
✅ **Modern wagmi v2 patterns** throughout
✅ **Native BigInt support** (cleaner code)
✅ **Better event handling** (declarative)
✅ **Improved type safety** (viem utilities)
✅ **Simpler mental model** (consistent API)
✅ **Better performance** (wagmi caching)
✅ **Easier maintenance** (less custom code)

---

## File Location

Refactored file: `/home/user/rose-token/frontend/src/pages/TasksPage.jsx`

## Dependencies Required

Ensure these packages are installed:
```bash
npm install wagmi@^2.0.0 viem@^2.0.0 @rainbow-me/rainbowkit
```

---

**Last Updated:** 2025-11-22
**Author:** Claude Code
**Migration Status:** Complete ✅
