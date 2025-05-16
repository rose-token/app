import React, { useState } from 'react';
import { ethers } from 'ethers';
import { useEthereum } from '../../hooks/useEthereum';
import { useContract } from '../../hooks/useContract';
import { NETWORK_IDS, NETWORK_NAMES } from '../../constants/networks';

const CreateTaskForm = ({ onTaskCreated }) => {
  const [description, setDescription] = useState('');
  const [deposit, setDeposit] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState('');
  
  const { isConnected, chainId } = useEthereum();
  const { roseMarketplace, roseToken, isLoading } = useContract();
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!isConnected) {
      setError('Please connect your wallet first');
      return;
    }
    
    if (chainId !== NETWORK_IDS.SEPOLIA) {
      setError(`Please switch to ${NETWORK_NAMES[NETWORK_IDS.SEPOLIA]} to create tasks`);
      return;
    }
    
    if (!description || !deposit) {
      setError('Please fill in all fields');
      return;
    }
    
    try {
      setError('');
      
      const tokenAmount = ethers.utils.parseEther(deposit);
      
      setIsApproving(true);
      const approveTx = await roseToken.approve(roseMarketplace.address, tokenAmount);
      await approveTx.wait();
      setIsApproving(false);
      
      setIsCreating(true);
      const tx = await roseMarketplace.createTask(
        description,
        tokenAmount
      );
      
      await tx.wait();
      
      setDescription('');
      setDeposit('');
      
      if (onTaskCreated) {
        onTaskCreated();
      }
    } catch (err) {
      console.error('Error creating task:', err);
      setError(err.message || 'Failed to create task');
    } finally {
      setIsApproving(false);
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
        
        {/* Stakeholder field removed - stakeholders will stake 10% after task creation */}
        
        <div className="mb-6">
          <label htmlFor="deposit" className="block text-sm font-medium text-gray-700 mb-1">
            ROSE Token Deposit
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
              <span className="text-gray-500">ROSE</span>
            </div>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            This amount in ROSE tokens will be paid to the worker upon successful completion
          </p>
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">
            {error}
          </div>
        )}
        
        <button
          type="submit"
          disabled={isCreating || isApproving || !isConnected}
          className={`w-full py-2 px-4 rounded-md font-medium text-white ${
            isCreating || isApproving || !isConnected
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-primary hover:bg-primary/90'
          }`}
        >
          {isApproving ? 'Approving ROSE Tokens...' : isCreating ? 'Creating Task...' : 'Create Task'}
        </button>
        
        <div className="mt-4">
          <button
            type="button"
            onClick={async () => {
              try {
                if (!roseMarketplace) {
                  setError('Wallet not connected or contracts not loaded. Please connect your wallet and try again.');
                  return;
                }
                
                const amount = ethers.utils.parseEther("100");
                const tx = await roseMarketplace.claimFaucetTokens(amount);
                await tx.wait();
                alert("Successfully claimed 100 ROSE tokens!");
              } catch (err) {
                console.error("Error claiming tokens:", err);
                setError(err.message || "Failed to claim tokens");
              }
            }}
            disabled={!roseMarketplace || isLoading}
            className={`w-full py-2 px-4 rounded-md font-medium text-white ${
              !roseMarketplace || isLoading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            Claim 100 ROSE Tokens (Test Faucet)
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateTaskForm;
