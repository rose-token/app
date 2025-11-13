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
      return 'bg-accent/20 text-accent-foreground';
    case TaskStatus.StakeholderRequired:
      return 'bg-secondary text-secondary-foreground';
    case TaskStatus.InProgress:
      return 'bg-rose-pink/50 text-rose-mauve';
    case TaskStatus.Completed:
      return 'bg-accent/30 text-accent-foreground';
    case TaskStatus.Closed:
      return 'bg-muted text-muted-foreground';
    case TaskStatus.ApprovedPendingPayment:
      return 'bg-primary/20 text-primary';
    default:
      return 'bg-muted text-muted-foreground';
  }
};
