import React from 'react';
import { useEthereum } from '../../hooks/useEthereum';
import { TaskStatus, getStatusText, getStatusColor } from '../../utils/taskStatus';
import ProgressTracker from '../governance/ProgressTracker';

const TaskCard = ({ task, onClaim, onUnclaim, onComplete, onApprove, onAcceptPayment, onStake, onCancel }) => {
  const { account } = useEthereum();

  const formatTokens = (wei) => {
    return parseFloat(wei) / 10**18;
  };

  const isCustomer = account && task.customer.toLowerCase() === account.toLowerCase();
  const isWorker = account && task.worker.toLowerCase() === account.toLowerCase();
  const isStakeholder = account && task.stakeholder.toLowerCase() === account.toLowerCase();

  const canClaim = !isCustomer && !isStakeholder && task.status === TaskStatus.Open && !isWorker;
  const canUnclaim = isWorker && task.status === TaskStatus.InProgress;
  const canStake = !isCustomer && !isWorker && task.status === TaskStatus.StakeholderRequired && task.stakeholder === '0x0000000000000000000000000000000000000000';
  const canComplete = isWorker && task.status === TaskStatus.InProgress;
  const canApproveAsCustomer = isCustomer && task.status === TaskStatus.Completed && !task.customerApproval;
  const canApproveAsStakeholder = isStakeholder && task.status === TaskStatus.Completed && !task.stakeholderApproval;
  const canAcceptPayment = isWorker && task.status === TaskStatus.ApprovedPendingPayment;

  // Task can be cancelled by customer or stakeholder before worker claims
  const canCancel = (isCustomer || isStakeholder) &&
    (task.status === TaskStatus.StakeholderRequired || task.status === TaskStatus.Open);
  
  
  console.log('TaskCard:', { isStakeholder, status: task.status, statusCompare: task.status === TaskStatus.Completed, stakeholderApproval: task.stakeholderApproval, canApproveAsStakeholder });
  
  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-4 border border-gray-200">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold">{task.description}</h3>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(task.status)}`}>
          {getStatusText(task.status)}
        </span>
      </div>
      
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-sm text-gray-500">Customer</p>
          <p className="text-sm font-medium truncate">{task.customer}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Deposit</p>
          <p className="text-sm font-medium">{formatTokens(task.deposit)} ROSE</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Worker</p>
          <p className="text-sm font-medium truncate">{task.worker || 'Not assigned'}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Stakeholder</p>
          <p className="text-sm font-medium truncate">{task.stakeholder}</p>
        </div>
        {task.stakeholderDeposit && task.stakeholderDeposit !== '0' && (
          <div>
            <p className="text-sm text-gray-500">Stakeholder Deposit</p>
            <p className="text-sm font-medium">{formatTokens(task.stakeholderDeposit)} ROSE</p>
          </div>
        )}
      </div>
      
      {task.status === TaskStatus.Completed && (
        <div className="mb-4 flex space-x-4">
          <div className="flex items-center">
            <span className={`w-3 h-3 rounded-full mr-2 ${task.customerApproval ? 'bg-green-500' : 'bg-gray-300'}`}></span>
            <span className="text-sm">Customer Approval</span>
          </div>
          <div className="flex items-center">
            <span className={`w-3 h-3 rounded-full mr-2 ${task.stakeholderApproval ? 'bg-green-500' : 'bg-gray-300'}`}></span>
            <span className="text-sm">Stakeholder Approval</span>
          </div>
        </div>
      )}
      
      <div className="flex flex-wrap gap-2 mt-4">
        {canStake && (
          <button 
            onClick={() => onStake(task.id)} 
            className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Stake as Stakeholder
          </button>
        )}
        
        {canClaim && (
          <button
            onClick={() => onClaim(task.id)}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Claim Task
          </button>
        )}

        {canUnclaim && (
          <button
            onClick={() => onUnclaim(task.id)}
            className="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-md text-sm font-medium"
            title="Release this task so another worker can claim it"
          >
            Unclaim Task
          </button>
        )}

        {canComplete && (
          <button 
            onClick={() => onComplete(task.id)} 
            className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Mark Completed
          </button>
        )}
        
        {canApproveAsCustomer && (
          <button 
            onClick={() => onApprove(task.id, 'customer')} 
            className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Approve as Customer
          </button>
        )}
        
        {canApproveAsStakeholder && (
          <button 
            onClick={() => onApprove(task.id, 'stakeholder')} 
            className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors duration-150 ease-in-out shadow-md border border-indigo-400"
          >
            ✓ Approve as Stakeholder
          </button>
        )}
        
        {canAcceptPayment && (
          <button
            onClick={() => onAcceptPayment(task.id)}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center space-x-1"
          >
            <span>Accept Payment</span>
            <span className="text-xs">(gas fees apply)</span>
          </button>
        )}

        {canCancel && (
          <button
            onClick={() => onCancel(task.id)}
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Cancel Task
          </button>
        )}
      </div>
      
      {/* Progress Tracker - visible to all participants */}
      {(isCustomer || isWorker || isStakeholder) && (
        <div className="mt-4">
          <ProgressTracker task={task} />
        </div>
      )}
    </div>
  );
};

export default TaskCard;
