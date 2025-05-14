import React, { useState } from 'react';
import { ethers } from 'ethers';
import { useEthereum } from '../../hooks/useEthereum';
import { useContract } from '../../hooks/useContract';

const CreateTaskForm = ({ onTaskCreated }) => {
  const [description, setDescription] = useState('');
  const [stakeholderAddress, setStakeholderAddress] = useState('');
  const [deposit, setDeposit] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  
  const { account, isConnected } = useEthereum();
  const { roseMarketplace, isLoading } = useContract();
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!isConnected) {
      setError('Please connect your wallet first');
      return;
    }
    
    if (!description || !stakeholderAddress || !deposit) {
      setError('Please fill in all fields');
      return;
    }
    
    if (!ethers.isAddress(stakeholderAddress)) {
      setError('Invalid stakeholder address');
      return;
    }
    
    try {
      setIsCreating(true);
      setError('');
      
      const depositWei = ethers.parseEther(deposit);
      
      const tx = await roseMarketplace.createTask(
        description,
        stakeholderAddress,
        { value: depositWei }
      );
      
      await tx.wait();
      
      setDescription('');
      setStakeholderAddress('');
      setDeposit('');
      
      if (onTaskCreated) {
        onTaskCreated();
      }
    } catch (err) {
      console.error('Error creating task:', err);
      setError(err.message || 'Failed to create task');
    } finally {
      setIsCreating(false);
    }
  };
  
  if (isLoading) {
    return <div className="text-center py-4">Loading contracts...</div>;
  }
  
  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200">
      <h2 className="text-xl font-semibold mb-4">Create New Task</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Task Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            rows="3"
            placeholder="Describe the task in detail..."
            required
          />
        </div>
        
        <div className="mb-4">
          <label htmlFor="stakeholder" className="block text-sm font-medium text-gray-700 mb-1">
            Stakeholder Address
          </label>
          <input
            id="stakeholder"
            type="text"
            value={stakeholderAddress}
            onChange={(e) => setStakeholderAddress(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="0x..."
            required
          />
          <p className="mt-1 text-sm text-gray-500">
            The stakeholder will validate the completed work and help resolve disputes
          </p>
        </div>
        
        <div className="mb-6">
          <label htmlFor="deposit" className="block text-sm font-medium text-gray-700 mb-1">
            ETH Deposit
          </label>
          <div className="relative">
            <input
              id="deposit"
              type="number"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="0.1"
              step="0.01"
              min="0"
              required
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <span className="text-gray-500">ETH</span>
            </div>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            This amount will be paid to the worker upon successful completion
          </p>
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">
            {error}
          </div>
        )}
        
        <button
          type="submit"
          disabled={isCreating || !isConnected}
          className={`w-full py-2 px-4 rounded-md font-medium text-white ${
            isCreating || !isConnected
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-primary hover:bg-primary/90'
          }`}
        >
          {isCreating ? 'Creating...' : 'Create Task'}
        </button>
      </form>
    </div>
  );
};

export default CreateTaskForm;
