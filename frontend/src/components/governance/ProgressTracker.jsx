import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { CheckCircle, Clock, Award } from 'lucide-react';

const ProgressTracker = ({ task }) => {
  const getStageStatus = (stage) => {
    // Task status: 0=StakeholderRequired, 1=Open, 2=InProgress, 3=Completed, 4=ApprovedPendingPayment, 5=Closed
    switch (stage) {
      case 'task-creation':
        return task ? 'completed' : 'pending';
      case 'stakeholder-stake':
        return task?.status >= 1 ? 'completed' :
               task?.status === 0 ? 'active' : 'pending';
      case 'worker-claim':
        return task?.status >= 2 ? 'completed' :
               task?.status === 1 ? 'active' : 'pending';
      case 'work-completion':
        return task?.status >= 3 ? 'completed' :
               task?.status === 2 ? 'active' : 'pending';
      case 'approval':
        return task?.status >= 4 ? 'completed' :
               task?.status === 3 ? 'active' : 'pending';
      case 'payment':
        return task?.status === 5 ? 'completed' :
               task?.status === 4 ? 'active' : 'pending';
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
      id: 'task-creation',
      title: 'Task Creation',
      description: 'Customer creates task and deposits ROSE tokens',
      status: getStageStatus('task-creation')
    },
    {
      id: 'stakeholder-stake',
      title: 'Stakeholder Stakes',
      description: 'Stakeholder stakes 10% of task value to validate',
      status: getStageStatus('stakeholder-stake')
    },
    {
      id: 'worker-claim',
      title: 'Worker Claims Task',
      description: 'Worker claims task (first-come, first-served)',
      status: getStageStatus('worker-claim')
    },
    {
      id: 'work-completion',
      title: 'Work Completion',
      description: 'Worker completes and submits the task',
      status: getStageStatus('work-completion')
    },
    {
      id: 'approval',
      title: 'Approval Process',
      description: 'Customer and stakeholder both approve the work',
      status: getStageStatus('approval')
    },
    {
      id: 'payment',
      title: 'Payment Distribution',
      description: 'Worker accepts payment (93/5/2 split)',
      status: getStageStatus('payment')
    }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Award className="h-5 w-5 mr-2" />
          Task Progress
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
              </div>
            </div>
          ))}
        </div>
        
        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <h5 className="text-sm font-medium text-blue-800 mb-1">Task Benefits</h5>
          <ul className="text-xs text-blue-700 space-y-1">
            <li>• Worker-focused: 93% of task value goes to worker</li>
            <li>• Stakeholder earns 50% ROI on 10% stake (5% fee + stake returned)</li>
            <li>• Sustainable platform: 2% minted to DAO treasury (~2% annual inflation)</li>
            <li>• Dual approval protects quality (customer + stakeholder)</li>
            <li>• Simple first-come, first-served worker assignment</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};

export default ProgressTracker;
