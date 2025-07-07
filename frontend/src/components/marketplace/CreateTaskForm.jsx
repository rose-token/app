import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useEthereum } from '../../hooks/useEthereum';
import { useContract } from '../../hooks/useContract';
import { NETWORK_IDS, NETWORK_NAMES } from '../../constants/networks';

const CreateTaskForm = ({ onTaskCreated }) => {
  const [description, setDescription] = useState('');
  const [detailedDescription, setDetailedDescription] = useState('');
  const [deposit, setDeposit] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState('');
  const [localContractsReady, setLocalContractsReady] = useState(false);
  
  const { isConnected, chainId } = useEthereum();
  const { 
    roseMarketplace, 
    roseToken, 
    isLoading, 
    error: contractError, 
    contractMethods,
    contractsReady 
  } = useContract();
  
  useEffect(() => {
    if (!isConnected) {
      setLocalContractsReady(false);
      return;
    }
    
    if (!isLoading && roseMarketplace && roseToken) {
      if (contractMethods.initialized && contractMethods.valid && contractsReady.readWrite) {
        setLocalContractsReady(true);
        setError('');
      } else if (contractMethods.initialized && !contractMethods.valid) {
        console.error('Contract methods validation failed');
        setLocalContractsReady(false);
        setError('Contract initialization error: createTask function not available');
      } else if (contractsReady.readOnly && !contractsReady.readWrite) {
        setLocalContractsReady(false);
        setError('Please connect your wallet to create tasks');
      }
    } else if (contractError) {
      setLocalContractsReady(false);
      setError(`Contract error: ${contractError}`);
    }
  }, [roseMarketplace, roseToken, isLoading, contractError, contractMethods, contractsReady, isConnected]);
  
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
    
    if (!localContractsReady) {
      if (!isConnected) {
        setError('Please connect your wallet to create tasks');
      } else if (contractsReady.readOnly && !contractsReady.readWrite) {
        setError('Wallet connected but contracts not initialized for write operations. Please wait a moment.');
      } else {
        setError('Contracts not properly initialized. Please refresh the page or reconnect your wallet.');
      }
      console.error('Contract state:', { 
        marketplaceExists: !!roseMarketplace,
        tokenExists: !!roseToken,
        isLoading,
        localContractsReady,
        contractsReady
      });
      return;
    }
    
    try {
      setError('');
      
      const tokenAmount = ethers.utils.parseEther(deposit);
      
      console.log('Using contracts:', {
        marketplaceAddress: roseMarketplace.address,
        tokenAddress: roseToken.address
      });
      
      setIsApproving(true);
      const approveTx = await roseToken.approve(roseMarketplace.address, tokenAmount);
      await approveTx.wait();
      setIsApproving(false);
      
      setIsCreating(true);
      const tx = await roseMarketplace.createTask(
        description,
        tokenAmount,
        detailedDescription // Add the detailed description parameter
      );
      
      await tx.wait();
      
      setDescription('');
      setDeposit('');
      setDetailedDescription(''); // Reset the detailed description
      
      if (onTaskCreated) {
        onTaskCreated();
      }
    } catch (err) {
      console.error('Error creating task:', err);
      
      if (err.code === 'INVALID_ARGUMENT') {
        setError('Invalid argument to createTask function. Check parameter types.');
      } else if (err.message && err.message.includes('not a function')) {
        setError('Contract method not found. Please refresh the page or reconnect your wallet.');
        
        console.error('Contract state when error occurred:', { 
          marketplaceExists: !!roseMarketplace,
          tokenExists: !!roseToken,
          isLoading,
          contractsReady,
          contractMethods: contractMethods || 'N/A'
        });
      } else if (err.message && err.message.includes('user rejected')) {
        setError('Transaction rejected. Please try again.');
      } else if (err.message && err.message.includes('insufficient funds')) {
        setError('Insufficient funds for transaction. Please check your balance.');
      } else {
        setError(err.message || 'Failed to create task');
      }
    } finally {
      setIsApproving(false);
      setIsCreating(false);
    }
  };
  
  if (isLoading) {
    return <div className="text-center py-4">Loading contracts...</div>;
  }
  
  if (!isConnected) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200">
        <h2 className="text-xl font-semibold mb-4">Create New Task</h2>
        <div className="text-center py-4 text-amber-600">
          Please connect your wallet to create tasks
        </div>
      </div>
    );
  }
  
  if (contractsReady && contractsReady.readOnly && !contractsReady.readWrite) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200">
        <h2 className="text-xl font-semibold mb-4">Create New Task</h2>
        <div className="text-center py-4 text-amber-600">
          Wallet connected but waiting for contract initialization. Please wait a moment...
        </div>
      </div>
    );
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
          <label htmlFor="detailedDescription" className="block text-sm font-medium text-gray-700 mb-1">
            Detailed Description (Optional)
          </label>
          <textarea
            id="detailedDescription"
            value={detailedDescription}
            onChange={(e) => setDetailedDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            rows="5"
            placeholder="Provide more in-depth information about the task (optional)..."
          />
          <p className="mt-1 text-sm text-gray-500">
            Use this field to provide additional details, requirements, or context for the task
          </p>
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
        
      </form>
    </div>
  );
};

export default CreateTaskForm;
