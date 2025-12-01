/**
 * StakingPanel - Deposit/Withdraw ROSE for governance participation
 * Shows current staking position and vROSE balance
 */

import React, { useState } from 'react';
import useGovernance from '../../hooks/useGovernance';
import useDelegation from '../../hooks/useDelegation';
import { calculateVotePower, formatVotePower } from '../../constants/contracts';

const StakingPanel = () => {
  const {
    stakedRose,
    stakedRoseRaw,
    allocatedRose,
    unallocatedRose,
    unallocatedRoseRaw,
    vRoseBalance,
    roseBalance,
    reputation,
    pendingRewards,
    loading,
    error,
    setError,
    depositStep,
    deposit,
    withdraw,
  } = useGovernance();

  // Map deposit step to user-friendly text
  const getDepositStepText = () => {
    switch (depositStep) {
      case 'checking': return 'Checking balances...';
      case 'simulating': return 'Validating transaction...';
      case 'approving': return 'Approve in wallet...';
      case 'approved': return 'Approval confirmed...';
      case 'depositing': return 'Confirm deposit in wallet...';
      case 'complete': return 'Deposit complete!';
      default: return null;
    }
  };

  const {
    isDelegating,
    totalDelegatedPower,
  } = useDelegation();

  // Calculate voting power: sqrt(unallocatedRose) * (reputation / 100) + delegated power received
  // If delegating to someone else, voting power is 0 (their power is with the delegate)
  const ownPower = calculateVotePower(unallocatedRoseRaw || 0n, reputation || 60);
  const receivedPower = parseFloat(totalDelegatedPower || '0');
  const votingPower = isDelegating ? 0 : (ownPower + receivedPower);

  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [activeTab, setActiveTab] = useState('deposit');

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;
    try {
      await deposit(depositAmount);
      setDepositAmount('');
    } catch (err) {
      console.error('Deposit failed:', err);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) return;
    try {
      await withdraw(withdrawAmount);
      setWithdrawAmount('');
    } catch (err) {
      console.error('Withdraw failed:', err);
    }
  };

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4">Governance Staking</h3>

      {/* Current Position Summary */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Staked ROSE</p>
          <p className="text-lg font-semibold">{parseFloat(stakedRose || 0).toLocaleString()}</p>
        </div>
        <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>vROSE Balance</p>
          <p className="text-lg font-semibold">{parseFloat(vRoseBalance || 0).toLocaleString()}</p>
        </div>
        <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Voting Power</p>
          <p className="text-lg font-semibold">{formatVotePower(votingPower)} VP</p>
        </div>
        <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Reputation</p>
          <p className="text-lg font-semibold">{(reputation || 60).toFixed(0)}%</p>
        </div>
      </div>

      {/* Allocated Warning */}
      {parseFloat(allocatedRose || 0) > 0 && (
        <div
          className="p-3 rounded-lg mb-4 text-sm"
          style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)' }}
        >
          {parseFloat(allocatedRose).toLocaleString()} ROSE allocated to votes/delegation.
          Unallocate before withdrawing.
        </div>
      )}

      {/* Pending Rewards */}
      {parseFloat(pendingRewards || 0) > 0 && (
        <div
          className="p-3 rounded-lg mb-4 text-sm"
          style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)' }}
        >
          {parseFloat(pendingRewards).toLocaleString()} ROSE in pending rewards
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b mb-4" style={{ borderColor: 'var(--border-color)' }}>
        <button
          onClick={() => setActiveTab('deposit')}
          className="flex-1 py-2 text-sm font-medium transition-colors"
          style={{
            color: activeTab === 'deposit' ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab === 'deposit' ? '2px solid var(--accent)' : '2px solid transparent',
          }}
        >
          Deposit
        </button>
        <button
          onClick={() => setActiveTab('withdraw')}
          className="flex-1 py-2 text-sm font-medium transition-colors"
          style={{
            color: activeTab === 'withdraw' ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab === 'withdraw' ? '2px solid var(--accent)' : '2px solid transparent',
          }}
        >
          Withdraw
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div
          className="p-3 rounded-lg mb-4 text-sm flex justify-between items-center"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)' }}
        >
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 font-bold">&times;</button>
        </div>
      )}

      {/* Deposit Tab */}
      {activeTab === 'deposit' && (
        <div>
          <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
            Deposit ROSE to participate in governance. You'll receive vROSE 1:1 which can be used as stakeholder collateral.
          </p>

          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full px-3 py-2 rounded-lg"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                }}
              />
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sm"
                style={{ color: 'var(--text-muted)' }}
              >
                ROSE
              </span>
            </div>
            <button
              onClick={() => setDepositAmount(roseBalance || '0')}
              className="px-3 py-2 rounded-lg text-sm"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
              }}
            >
              Max
            </button>
          </div>

          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
            Available: {parseFloat(roseBalance || 0).toLocaleString()} ROSE
          </p>

          {/* Step Progress Indicator */}
          {depositStep && (
            <div
              className="p-3 rounded-lg mb-3 text-sm flex items-center gap-2"
              style={{
                backgroundColor: depositStep === 'complete'
                  ? 'rgba(16, 185, 129, 0.1)'
                  : 'rgba(59, 130, 246, 0.1)',
                color: depositStep === 'complete' ? 'var(--success)' : 'var(--accent)',
              }}
            >
              {depositStep !== 'complete' && (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {depositStep === 'complete' && (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              <span>{getDepositStepText()}</span>
            </div>
          )}

          <button
            onClick={handleDeposit}
            disabled={loading.deposit || !depositAmount || parseFloat(depositAmount) <= 0}
            className="btn-primary w-full"
            style={{ opacity: loading.deposit || !depositAmount || parseFloat(depositAmount) <= 0 ? 0.5 : 1 }}
          >
            {loading.deposit ? (getDepositStepText() || 'Depositing...') : 'Deposit ROSE'}
          </button>
        </div>
      )}

      {/* Withdraw Tab */}
      {activeTab === 'withdraw' && (
        <div>
          <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
            Withdraw ROSE from governance. Requires vROSE returned (not locked in tasks) and ROSE unallocated from votes.
          </p>

          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full px-3 py-2 rounded-lg"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                }}
              />
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sm"
                style={{ color: 'var(--text-muted)' }}
              >
                ROSE
              </span>
            </div>
            <button
              onClick={() => setWithdrawAmount(Math.min(
                parseFloat(unallocatedRose || 0),
                parseFloat(vRoseBalance || 0)
              ).toString())}
              className="px-3 py-2 rounded-lg text-sm"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
              }}
            >
              Max
            </button>
          </div>

          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
            Withdrawable: {Math.min(
              parseFloat(unallocatedRose || 0),
              parseFloat(vRoseBalance || 0)
            ).toLocaleString()} ROSE
          </p>

          <button
            onClick={handleWithdraw}
            disabled={loading.withdraw || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
            className="btn-secondary w-full"
            style={{ opacity: loading.withdraw || !withdrawAmount || parseFloat(withdrawAmount) <= 0 ? 0.5 : 1 }}
          >
            {loading.withdraw ? 'Withdrawing...' : 'Withdraw ROSE'}
          </button>
        </div>
      )}

      {/* Info Box */}
      <div className="mt-4 p-3 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
        <strong>How it works:</strong>
        <ul className="mt-1 list-disc list-inside space-y-1">
          <li>Deposit ROSE to receive vROSE 1:1</li>
          <li>Staked ROSE can be allocated to votes or delegates</li>
          <li>vROSE can be used as stakeholder collateral in tasks</li>
          <li>Withdraw requires both vROSE returned AND ROSE unallocated</li>
        </ul>
      </div>
    </div>
  );
};

export default StakingPanel;
