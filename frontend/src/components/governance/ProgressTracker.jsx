import React from 'react';
import { CheckCircle, Clock, Award } from 'lucide-react';

const ProgressTracker = ({ task }) => {
  const getStageStatus = (stage) => {
    // Task status from contract enum: 0=Open, 1=StakeholderRequired, 2=InProgress, 3=Completed, 4=Closed, 5=ApprovedPendingPayment
    // Lifecycle flow: Created(1) → Staked(0) → Claimed(2) → Completed(3) → Approved(5) → Closed(4)
    switch (stage) {
      case 'task-creation':
        return task ? 'completed' : 'pending';
      case 'stakeholder-stake':
        // Status 1 = StakeholderRequired (active, waiting for stake)
        // Status 0, 2, 3, 5, 4 = already staked (completed)
        return task?.status === 1 ? 'active' :
               (task?.status === 0 || task?.status >= 2) ? 'completed' : 'pending';
      case 'worker-claim':
        // Status 0 = Open (active, ready for worker to claim)
        // Status 2, 3, 5, 4 = worker already claimed (completed)
        // Status 1 = still needs stakeholder (pending)
        return task?.status >= 2 ? 'completed' :
               task?.status === 0 ? 'active' : 'pending';
      case 'work-completion':
        // Status 2 = InProgress (active, worker is working)
        // Status 3, 5, 4 = work already completed (completed)
        return (task?.status >= 3 && task?.status !== 0) ? 'completed' :
               task?.status === 2 ? 'active' : 'pending';
      case 'approval':
        // Status 3 = Completed (active, awaiting approval)
        // Status 5, 4 = already approved (completed)
        return (task?.status === 5 || task?.status === 4) ? 'completed' :
               task?.status === 3 ? 'active' : 'pending';
      case 'payment':
        // Status 4 = Closed (completed, payment distributed)
        // Status 5 = ApprovedPendingPayment (active, ready for payment)
        return task?.status === 4 ? 'completed' :
               task?.status === 5 ? 'active' : 'pending';
      default:
        return 'pending';
    }
  };

  const getStageIcon = (stage, status) => {
    if (status === 'completed') {
      return (
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--success)' }}
        >
          <CheckCircle className="h-3.5 w-3.5" style={{ color: 'var(--bg-primary)' }} />
        </div>
      );
    }
    if (status === 'active') {
      return (
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--rose-pink)' }}
        >
          <Clock className="h-3.5 w-3.5" style={{ color: 'var(--bg-primary)' }} />
        </div>
      );
    }
    return (
      <div
        className="w-6 h-6 rounded-full flex-shrink-0"
        style={{ border: '2px solid var(--border-subtle)', background: 'transparent' }}
      />
    );
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
      description: 'Worker accepts payment (95/5 split)',
      status: getStageStatus('payment')
    }
  ];

  return (
    <div
      className="rounded-xl p-5 mt-4"
      style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Award className="h-[18px] w-[18px]" style={{ color: 'var(--rose-pink)' }} />
        <span className="font-semibold text-[0.9375rem]" style={{ color: 'var(--text-primary)' }}>
          Task Progress
        </span>
      </div>
      <div className="flex flex-col">
        {stages.map((stage, index) => (
          <div key={stage.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              {getStageIcon(stage.id, stage.status)}
              {index < stages.length - 1 && (
                <div
                  className="w-0.5 my-1"
                  style={{
                    height: '32px',
                    background: stage.status === 'completed'
                      ? 'var(--success)'
                      : 'var(--border-subtle)'
                  }}
                />
              )}
            </div>
            <div className="flex-1 pb-6">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                  {stage.title}
                </span>
                <span
                  className="text-[0.625rem] uppercase tracking-wide px-2 py-1 rounded"
                  style={
                    stage.status === 'completed'
                      ? { background: 'var(--success-bg)', color: 'var(--success)' }
                      : stage.status === 'active'
                      ? { background: 'rgba(212, 175, 140, 0.15)', color: 'var(--rose-gold)' }
                      : { background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)' }
                  }
                >
                  {stage.status === 'completed' ? 'Complete' :
                   stage.status === 'active' ? 'Active' : 'Pending'}
                </span>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {stage.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProgressTracker;
