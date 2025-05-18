export const TaskStatus = {
  Open: 0,
  StakeholderRequired: 1,
  InProgress: 2,
  Completed: 3,
  Disputed: 4,
  Closed: 5,
  ApprovedPendingPayment: 6,
  RefundRequested: 7
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
    case TaskStatus.Disputed:
      return 'Disputed';
    case TaskStatus.Closed:
      return 'Closed';
    case TaskStatus.ApprovedPendingPayment:
      return 'Ready for Payment';
    case TaskStatus.RefundRequested:
      return 'Refund Requested';
    default:
      return 'Unknown';
  }
};

export const getStatusColor = (status) => {
  switch (parseInt(status)) {
    case TaskStatus.Open:
      return 'bg-blue-100 text-blue-800';
    case TaskStatus.StakeholderRequired:
      return 'bg-orange-100 text-orange-800';
    case TaskStatus.InProgress:
      return 'bg-yellow-100 text-yellow-800';
    case TaskStatus.Completed:
      return 'bg-green-100 text-green-800';
    case TaskStatus.Disputed:
      return 'bg-red-100 text-red-800';
    case TaskStatus.Closed:
      return 'bg-gray-100 text-gray-800';
    case TaskStatus.ApprovedPendingPayment:
      return 'bg-purple-100 text-purple-800';
    case TaskStatus.RefundRequested:
      return 'bg-pink-100 text-pink-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};
