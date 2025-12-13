/**
 * TaskTable Component
 *
 * Table-based view for tasks with filtering and action buttons.
 * Design matches the dark card table layout with:
 * - Header with "Open Tasks", Filter button, and "+ Create Task" button
 * - Columns: Task (title+ID), Reward, Customer, Stakeholder, Status, Action
 */

import React, { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import ProfileBadge from '../profile/ProfileBadge';
import Spinner from '../ui/Spinner';
import { TaskStatus, getStatusText } from '../../utils/taskStatus';
import { useTaskSkills } from '../../hooks/useTaskSkills';
import { useProfile } from '../../hooks/useProfile';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Get the status badge variant based on task status
 */
const getStatusBadgeVariant = (status, isAuction = false) => {
  switch (status) {
    case TaskStatus.Open:
      return 'success'; // Green
    case TaskStatus.StakeholderRequired:
      return 'warning'; // Yellow/orange
    case TaskStatus.InProgress:
      return 'info'; // Blue
    case TaskStatus.Completed:
      return 'complete';
    case TaskStatus.ApprovedPendingPayment:
      return 'success';
    case TaskStatus.Closed:
      return 'secondary';
    case TaskStatus.Disputed:
      return 'destructive';
    default:
      return 'default';
  }
};

/**
 * Determine which action button to show based on task state and user role
 */
const getQuickAction = (task, account) => {
  if (!account) return null;

  const accountLower = account.toLowerCase();
  const isCustomer = task.customer?.toLowerCase() === accountLower;
  const isWorker = task.worker?.toLowerCase() === accountLower;
  const isStakeholder = task.stakeholder?.toLowerCase() === accountLower;
  const hasStakeholder = task.stakeholder && task.stakeholder !== ZERO_ADDRESS;
  const hasWorker = task.worker && task.worker !== ZERO_ADDRESS;

  // Status-based action determination
  switch (task.status) {
    case TaskStatus.StakeholderRequired:
      // Anyone (except customer) can stake
      if (!isCustomer) {
        return { action: 'stake', label: 'Stake', variant: 'default' };
      }
      return null;

    case TaskStatus.Open:
      // Workers can claim (if not auction)
      if (!isCustomer && !isStakeholder && !hasWorker && !task.isAuction) {
        return { action: 'claim', label: 'Claim', variant: 'outline' };
      }
      // Auction tasks - show Bid (only if no worker assigned)
      if (task.isAuction && !isCustomer && !isStakeholder && !hasWorker) {
        return { action: 'view', label: 'Bid', variant: 'outline' };
      }
      // Customer can view bids for auction
      if (task.isAuction && isCustomer) {
        return { action: 'view', label: 'View Bids', variant: 'outline' };
      }
      return { action: 'view', label: 'View', variant: 'ghost' };

    case TaskStatus.InProgress:
      // Worker can mark complete
      if (isWorker) {
        return { action: 'complete', label: 'Mark Complete', variant: 'default' };
      }
      return { action: 'view', label: 'View', variant: 'ghost' };

    case TaskStatus.Completed:
      // Customer and stakeholder can approve
      if (isCustomer && !task.customerApproval) {
        return { action: 'approve', label: 'Approve', variant: 'success' };
      }
      if (isStakeholder && !task.stakeholderApproval) {
        return { action: 'approve', label: 'Approve', variant: 'success' };
      }
      return { action: 'view', label: 'View', variant: 'ghost' };

    case TaskStatus.ApprovedPendingPayment:
      // Worker can accept payment
      if (isWorker) {
        return { action: 'acceptPayment', label: 'Accept Payment', variant: 'success' };
      }
      return { action: 'view', label: 'View', variant: 'ghost' };

    case TaskStatus.Disputed:
      return { action: 'view', label: 'View', variant: 'ghost' };

    case TaskStatus.Closed:
      return { action: 'view', label: 'View', variant: 'ghost' };

    default:
      return { action: 'view', label: 'View', variant: 'ghost' };
  }
};

/**
 * Format token amount to ROSE
 */
const formatReward = (depositWei) => {
  try {
    const amount = formatUnits(BigInt(depositWei), 18);
    const num = parseFloat(amount);
    if (num >= 1000) {
      return num.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' ROSE';
    }
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ROSE';
  } catch {
    return '0 ROSE';
  }
};

const TaskTable = ({
  tasks,
  isLoading,
  loadingStates = {},
  filters,
  setFilters,
  onClaimTask,
  onStakeTask,
  onCompleteTask,
  onApproveTask,
  onAcceptPayment,
  // Optional pagination props
  pagination = null,
  onPageChange = null,
}) => {
  const navigate = useNavigate();
  const { address: account } = useAccount();
  const [showFilters, setShowFilters] = useState(false);

  // Get user profile skills
  const { profile } = useProfile();
  const userSkills = profile?.skills || [];

  // Get task skills and matching logic
  const { hasSkillMatch } = useTaskSkills(tasks);

  // Apply skills match filter locally (since skill data comes from IPFS, not blockchain)
  const displayedTasks = useMemo(() => {
    if (!filters?.skillsMatch || userSkills.length === 0) {
      return tasks;
    }
    return tasks.filter(task => hasSkillMatch(task.id, userSkills));
  }, [tasks, filters?.skillsMatch, userSkills, hasSkillMatch]);

  // Handle action button click
  const handleAction = (e, task, action) => {
    e.stopPropagation(); // Prevent row click

    switch (action.action) {
      case 'stake':
        onStakeTask?.(task.id);
        break;
      case 'claim':
        onClaimTask?.(task.id);
        break;
      case 'complete':
        // Navigate to detail page to enter PR URL
        navigate(`/task/${task.id}`);
        break;
      case 'approve':
        const isCustomerApprove = task.customer?.toLowerCase() === account?.toLowerCase();
        onApproveTask?.(task.id, isCustomerApprove ? 'customer' : 'stakeholder');
        break;
      case 'acceptPayment':
        onAcceptPayment?.(task.id);
        break;
      case 'view':
      default:
        navigate(`/task/${task.id}`);
        break;
    }
  };

  // Check if action is loading
  const isActionLoading = (task, action) => {
    if (!loadingStates) return false;
    switch (action) {
      case 'stake':
        return loadingStates.stake?.[task.id];
      case 'claim':
        return loadingStates.claim?.[task.id];
      case 'complete':
        return loadingStates.complete?.[task.id];
      case 'approve':
        return loadingStates.approveCustomer?.[task.id] || loadingStates.approveStakeholder?.[task.id];
      case 'acceptPayment':
        return loadingStates.acceptPayment?.[task.id];
      default:
        return false;
    }
  };

  // Status filter options
  // Note: 'all' (Active Tasks) excludes Closed and Disputed by default
  // Users must explicitly select Closed or Disputed to view them
  const statusOptions = [
    { value: 'all', label: 'Active Tasks' },
    { value: 'stakeholderRequired', label: 'Needs Stakeholder' },
    { value: 'open', label: 'Open' },
    { value: 'inProgress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'approvedPendingPayment', label: 'Ready for Payment' },
    { value: 'disputed', label: 'Disputed' },
    { value: 'closed', label: 'Closed' },
  ];

  return (
    <div
      className="rounded-[20px] backdrop-blur-[20px] overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 md:px-6 py-4 md:py-5"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <h2 className="font-display text-xl font-medium" style={{ color: 'var(--text-primary)' }}>
          Open Tasks
        </h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filter
          </Button>
          <Link to="/create-task">
            <Button size="sm" className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Task
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters (collapsible) */}
      {showFilters && (
        <div
          className="px-4 md:px-6 py-3 md:py-4 flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3 sm:gap-4"
          style={{ borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.02)' }}
        >
          {/* Status dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-sm" style={{ color: 'var(--text-muted)' }}>Status:</label>
            <select
              value={filters?.status || 'all'}
              onChange={(e) => setFilters?.({ ...filters, status: e.target.value })}
              className="px-3 py-1.5 rounded-lg text-sm"
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            >
              {statusOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* My Tasks toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters?.myTasks || false}
              onChange={(e) => setFilters?.({ ...filters, myTasks: e.target.checked })}
              className="w-4 h-4 rounded"
              style={{ accentColor: 'var(--rose-pink)' }}
            />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>My Tasks</span>
          </label>

          {/* Skills Match toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters?.skillsMatch || false}
              onChange={(e) => setFilters?.({ ...filters, skillsMatch: e.target.checked })}
              className="w-4 h-4 rounded"
              style={{ accentColor: 'var(--rose-pink)' }}
              disabled={userSkills.length === 0}
            />
            <span
              className="text-sm"
              style={{ color: userSkills.length === 0 ? 'var(--text-muted)' : 'var(--text-secondary)' }}
              title={userSkills.length === 0 ? 'Add skills to your profile to use this filter' : ''}
            >
              Skills Match
            </span>
          </label>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th className="text-left px-3 md:px-6 py-3 md:py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Task
              </th>
              <th className="text-left px-2 md:px-4 py-3 md:py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Deposit
              </th>
              <th className="hidden md:table-cell text-left px-4 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Customer
              </th>
              <th className="hidden md:table-cell text-left px-4 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Stakeholder
              </th>
              <th className="text-left px-2 md:px-4 py-3 md:py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Status
              </th>
              <th className="text-right px-3 md:px-6 py-3 md:py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              // Loading skeleton
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td className="px-3 md:px-6 py-4 md:py-5">
                    <div className="h-5 w-32 md:w-48 rounded animate-pulse" style={{ background: 'var(--bg-secondary)' }} />
                    <div className="h-3 w-16 md:w-24 rounded animate-pulse mt-2" style={{ background: 'var(--bg-secondary)' }} />
                  </td>
                  <td className="px-2 md:px-4 py-4 md:py-5">
                    <div className="h-5 w-16 md:w-24 rounded animate-pulse" style={{ background: 'var(--bg-secondary)' }} />
                  </td>
                  <td className="hidden md:table-cell px-4 py-5">
                    <div className="h-5 w-20 rounded animate-pulse" style={{ background: 'var(--bg-secondary)' }} />
                  </td>
                  <td className="hidden md:table-cell px-4 py-5">
                    <div className="h-5 w-20 rounded animate-pulse" style={{ background: 'var(--bg-secondary)' }} />
                  </td>
                  <td className="px-2 md:px-4 py-4 md:py-5">
                    <div className="h-6 w-16 md:w-20 rounded-full animate-pulse" style={{ background: 'var(--bg-secondary)' }} />
                  </td>
                  <td className="px-3 md:px-6 py-4 md:py-5 text-right">
                    <div className="h-8 w-14 md:w-16 rounded animate-pulse ml-auto" style={{ background: 'var(--bg-secondary)' }} />
                  </td>
                </tr>
              ))
            ) : displayedTasks.length === 0 ? (
              // Empty state
              <tr>
                <td colSpan={6} className="px-4 md:px-6 py-12 text-center">
                  <p style={{ color: 'var(--text-muted)' }}>No tasks found</p>
                  <Link to="/create-task">
                    <Button className="mt-4" size="sm">Create a Task</Button>
                  </Link>
                </td>
              </tr>
            ) : (
              // Task rows
              displayedTasks.map(task => {
                const action = getQuickAction(task, account);
                const hasStakeholder = task.stakeholder && task.stakeholder !== ZERO_ADDRESS;
                const loading = action ? isActionLoading(task, action.action) : false;

                return (
                  <tr
                    key={task.id}
                    onClick={() => navigate(`/task/${task.id}`)}
                    className="cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Task title + ID */}
                    <td className="px-3 md:px-6 py-4 md:py-5">
                      <div className="flex items-center gap-2">
                        {/* Star indicator for skill match */}
                        {hasSkillMatch(task.id, userSkills) && userSkills.length > 0 && (
                          <svg
                            className="w-4 h-4 flex-shrink-0"
                            style={{ color: 'var(--rose-gold)' }}
                            fill="currentColor"
                            viewBox="0 0 20 20"
                            title="You have matching skills for this task"
                          >
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                        )}
                        <div className="font-medium text-sm md:text-base" style={{ color: 'var(--text-primary)' }}>
                          {task.description || 'Untitled Task'}
                        </div>
                      </div>
                      <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        #{task.id} {task.isAuction && '• Auction'}
                      </div>
                    </td>

                    {/* Reward */}
                    <td className="px-2 md:px-4 py-4 md:py-5">
                      <span className="font-medium text-sm md:text-base" style={{ color: 'var(--rose-gold)' }}>
                        {formatReward(task.deposit)}
                      </span>
                    </td>

                    {/* Customer - hidden on mobile */}
                    <td className="hidden md:table-cell px-4 py-5">
                      <ProfileBadge address={task.customer} size="sm" showAddress={false} />
                    </td>

                    {/* Stakeholder - hidden on mobile */}
                    <td className="hidden md:table-cell px-4 py-5">
                      {hasStakeholder ? (
                        <ProfileBadge address={task.stakeholder} size="sm" showAddress={false} />
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          Not Assigned
                        </span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-2 md:px-4 py-4 md:py-5">
                      <Badge variant={getStatusBadgeVariant(task.status, task.isAuction)}>
                        {getStatusText(task.status, task.isAuction)}
                      </Badge>
                    </td>

                    {/* Action */}
                    <td className="px-3 md:px-6 py-4 md:py-5 text-right">
                      {action && (
                        <Button
                          variant={action.variant}
                          size="sm"
                          onClick={(e) => handleAction(e, task, action)}
                          disabled={loading}
                        >
                          {loading ? <Spinner className="h-4 w-4" /> : action.label}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {pagination && pagination.totalPages > 1 && (
        <div
          className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Showing {displayedTasks.length} of {pagination.total} tasks
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasPrev}
              onClick={() => onPageChange?.(pagination.page - 1)}
            >
              Previous
            </Button>
            <span
              className="text-sm px-2 md:px-3"
              style={{ color: 'var(--text-secondary)' }}
            >
              {pagination.page}/{pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasNext}
              onClick={() => onPageChange?.(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskTable;
