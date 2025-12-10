// Task status enum matching RoseMarketplace.sol contract
// enum TaskStatus { Open, StakeholderRequired, InProgress, Completed, Closed, ApprovedPendingPayment, Disputed }
export const TaskStatus = {
  Open: 0,
  StakeholderRequired: 1,
  InProgress: 2,
  Completed: 3,
  Closed: 4,
  ApprovedPendingPayment: 5,
  Disputed: 6
};

/**
 * Get human-readable status text for a task.
 * @param {number} status - Task status enum value
 * @param {boolean} isAuction - Whether the task is an auction
 * @returns {string} Status text
 */
export const getStatusText = (status, isAuction = false) => {
  switch (parseInt(status)) {
    case TaskStatus.Open:
      return isAuction ? 'Accepting Bids' : 'Open';
    case TaskStatus.StakeholderRequired:
      return 'Needs Stakeholder';
    case TaskStatus.InProgress:
      return 'In Progress';
    case TaskStatus.Completed:
      return 'Completed';
    case TaskStatus.Closed:
      return 'Closed';
    case TaskStatus.ApprovedPendingPayment:
      return 'Ready for Payment';
    case TaskStatus.Disputed:
      return 'Disputed';
    default:
      return 'Unknown';
  }
};

export const getStatusColor = (status) => {
  switch (parseInt(status)) {
    case TaskStatus.Open:
      return 'bg-status-open text-status-open-foreground';
    case TaskStatus.StakeholderRequired:
      return 'bg-status-stakeholder-needed text-status-stakeholder-needed-foreground';
    case TaskStatus.InProgress:
      return 'bg-status-in-progress text-status-in-progress-foreground';
    case TaskStatus.Completed:
      return 'bg-status-completed text-status-completed-foreground';
    case TaskStatus.Closed:
      return 'bg-status-closed text-status-closed-foreground';
    case TaskStatus.ApprovedPendingPayment:
      return 'bg-status-approved text-status-approved-foreground';
    case TaskStatus.Disputed:
      return 'bg-destructive text-destructive-foreground';
    default:
      return 'bg-status-closed text-status-closed-foreground';
  }
};
