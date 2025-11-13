// Task status enum matching RoseMarketplace.sol contract
// enum TaskStatus { Open, StakeholderRequired, InProgress, Completed, Closed, ApprovedPendingPayment }
export const TaskStatus = {
  Open: 0,
  StakeholderRequired: 1,
  InProgress: 2,
  Completed: 3,
  Closed: 4,
  ApprovedPendingPayment: 5
};

export const getStatusText = (status) => {
  switch (parseInt(status)) {
    case TaskStatus.Open:
      return 'Open';
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
    default:
      return 'bg-status-closed text-status-closed-foreground';
  }
};
