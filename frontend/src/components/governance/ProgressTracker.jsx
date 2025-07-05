import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { CheckCircle, Clock, Award } from 'lucide-react';

const ProgressTracker = ({ proposal, task, stakeholderApprovals }) => {
  const getStageStatus = (stage) => {
    switch (stage) {
      case 'proposal':
        return proposal?.status === 'Approved' ? 'completed' : 
               proposal?.status === 'Active' ? 'active' : 'pending';
      case 'stakeholder-selection':
        return task?.stakeholder && task.stakeholder !== '0x0000000000000000000000000000000000000000' ? 'completed' : 
               proposal?.status === 'Approved' ? 'active' : 'pending';
      case 'work-execution':
        return task?.status === 3 ? 'completed' : // Completed status
               task?.status === 2 ? 'active' : 'pending'; // InProgress status
      case 'stakeholder-approval':
        return stakeholderApprovals?.isApproved ? 'completed' :
               task?.status === 3 ? 'active' : 'pending';
      case 'payment':
        return task?.status === 5 ? 'completed' : // Closed/Paid status
               stakeholderApprovals?.isApproved ? 'active' : 'pending';
      default:
        return 'pending';
    }
  };

  const getStageIcon = (stage, status) => {
    if (status === 'completed') return <CheckCircle className="h-5 w-5 text-green-600" />;
    if (status === 'active') return <Clock className="h-5 w-5 text-blue-600" />;
    return <div className="h-5 w-5 rounded-full border-2 border-gray-300" />;
  };

  const stages = [
    {
      id: 'proposal',
      title: 'DAO Proposal',
      description: 'Community evaluates proposal through STAR voting',
      status: getStageStatus('proposal')
    },
    {
      id: 'stakeholder-selection',
      title: 'Stakeholder Selection',
      description: '2-week cycle for ranked choice stakeholder voting',
      status: getStageStatus('stakeholder-selection')
    },
    {
      id: 'work-execution',
      title: 'Work Execution',
      description: 'Selected worker completes the task',
      status: getStageStatus('work-execution')
    },
    {
      id: 'stakeholder-approval',
      title: 'Stakeholder Approval',
      description: '66% stakeholder threshold for final payout',
      status: getStageStatus('stakeholder-approval')
    },
    {
      id: 'payment',
      title: 'Payment Distribution',
      description: 'Worker accepts payment (60/20/20 split)',
      status: getStageStatus('payment')
    }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Award className="h-5 w-5 mr-2" />
          Unified Governance Progress
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {stages.map((stage, index) => (
            <div key={stage.id} className="flex items-start space-x-3">
              <div className="flex flex-col items-center">
                {getStageIcon(stage.id, stage.status)}
                {index < stages.length - 1 && (
                  <div className={`w-0.5 h-8 mt-2 ${
                    stage.status === 'completed' ? 'bg-green-600' : 'bg-gray-300'
                  }`} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">{stage.title}</h4>
                  <Badge variant={
                    stage.status === 'completed' ? 'default' :
                    stage.status === 'active' ? 'secondary' : 'outline'
                  }>
                    {stage.status === 'completed' ? 'Complete' :
                     stage.status === 'active' ? 'Active' : 'Pending'}
                  </Badge>
                </div>
                <p className="text-xs text-gray-600 mt-1">{stage.description}</p>
                
                {/* Additional details for active stages */}
                {stage.id === 'stakeholder-approval' && stage.status === 'active' && stakeholderApprovals && (
                  <div className="mt-2 p-2 bg-yellow-50 rounded text-xs">
                    <div className="flex justify-between items-center">
                      <span>Approval Progress:</span>
                      <span className="font-medium">
                        {stakeholderApprovals.approvalCount}/{stakeholderApprovals.totalStakeholders} 
                        ({stakeholderApprovals.approvalPercentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                      <div 
                        className="bg-yellow-500 h-1.5 rounded-full" 
                        style={{ width: `${Math.min(100, stakeholderApprovals.approvalPercentage)}%` }}
                      />
                    </div>
                    <p className="text-yellow-700 mt-1">
                      Need {(66 - stakeholderApprovals.approvalPercentage).toFixed(1)}% more for approval
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        
        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <h5 className="text-sm font-medium text-blue-800 mb-1">Governance Benefits</h5>
          <ul className="text-xs text-blue-700 space-y-1">
            <li>• Prevents bad actors from playing multiple roles</li>
            <li>• Ensures stakeholder legitimacy through token staking</li>
            <li>• Democratic decision-making via ranked choice voting</li>
            <li>• 66% approval threshold protects against collusion</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};

export default ProgressTracker;
