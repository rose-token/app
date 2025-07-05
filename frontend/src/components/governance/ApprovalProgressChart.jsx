import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { CheckCircle, Clock, AlertTriangle } from 'lucide-react';

const ApprovalProgressChart = ({ approvalData, className = "" }) => {
  if (!approvalData || Object.keys(approvalData).length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg">Approval Progress Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">No pending approvals to track.</p>
        </CardContent>
      </Card>
    );
  }

  const approvalStats = Object.values(approvalData).reduce(
    (stats, progress) => {
      if (progress.isApproved) {
        stats.approved++;
      } else if (progress.approvalPercentage >= 50) {
        stats.nearApproval++;
      } else {
        stats.needsAttention++;
      }
      stats.total++;
      return stats;
    },
    { approved: 0, nearApproval: 0, needsAttention: 0, total: 0 }
  );

  const getProgressColor = (percentage, isApproved) => {
    if (isApproved) return 'bg-green-600';
    if (percentage >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getStatusIcon = (progress) => {
    if (progress.isApproved) {
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    } else if (progress.approvalPercentage >= 50) {
      return <Clock className="h-4 w-4 text-yellow-600" />;
    } else {
      return <AlertTriangle className="h-4 w-4 text-red-600" />;
    }
  };

  const getStatusText = (progress) => {
    if (progress.isApproved) return 'Approved';
    if (progress.approvalPercentage >= 50) return 'Near Approval';
    return 'Needs Attention';
  };

  const getStatusVariant = (progress) => {
    if (progress.isApproved) return 'default';
    if (progress.approvalPercentage >= 50) return 'secondary';
    return 'destructive';
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg">Approval Progress Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="flex items-center justify-center mb-2">
                <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
                <span className="font-semibold text-green-800">Approved</span>
              </div>
              <p className="text-2xl font-bold text-green-600">{approvalStats.approved}</p>
            </div>
            
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <div className="flex items-center justify-center mb-2">
                <Clock className="h-5 w-5 text-yellow-600 mr-2" />
                <span className="font-semibold text-yellow-800">Near Approval</span>
              </div>
              <p className="text-2xl font-bold text-yellow-600">{approvalStats.nearApproval}</p>
            </div>
            
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <div className="flex items-center justify-center mb-2">
                <AlertTriangle className="h-5 w-5 text-red-600 mr-2" />
                <span className="font-semibold text-red-800">Needs Attention</span>
              </div>
              <p className="text-2xl font-bold text-red-600">{approvalStats.needsAttention}</p>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold text-gray-900">Task Approval Details</h4>
            {Object.entries(approvalData).map(([taskId, progress]) => (
              <div key={taskId} className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    {getStatusIcon(progress)}
                    <span className="font-medium">Task #{taskId}</span>
                    <Badge variant={getStatusVariant(progress)}>
                      {getStatusText(progress)}
                    </Badge>
                  </div>
                  <span className="text-sm text-gray-600">
                    {progress.approvalCount}/{progress.totalStakeholders} stakeholders
                  </span>
                </div>
                
                <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                  <div 
                    className={`h-2 rounded-full ${getProgressColor(progress.approvalPercentage, progress.isApproved)}`}
                    style={{ width: `${Math.min(100, progress.approvalPercentage)}%` }}
                  ></div>
                </div>
                
                <div className="flex justify-between text-xs text-gray-600">
                  <span>{progress.approvalPercentage.toFixed(1)}% approved</span>
                  <span>
                    {progress.isApproved 
                      ? '✓ Ready for payout' 
                      : `Need ${progress.needsMoreApprovals.toFixed(1)}% more (${Math.ceil((progress.needsMoreApprovals / 100) * progress.totalStakeholders)} stakeholders)`
                    }
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ApprovalProgressChart;
