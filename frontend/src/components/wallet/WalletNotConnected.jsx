import React, { useState } from 'react';
import { useEthereum } from '../../hooks/useEthereum';

const WalletNotConnected = () => {
  const { connectWallet } = useEthereum();
  const [showDetails, setShowDetails] = useState(false);
    
  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200 text-center">
      <h2 className="text-xl font-semibold mb-4">Connect Your Wallet</h2>
        
      <div className="mb-6 text-gray-600">
        <p className="mb-4">
          Connect your wallet to create tasks, claim work, and earn ROSE tokens
        </p>
          
        {/* Educational content about Rose Token */}
        <div className="mt-6 text-left">
          <h3 className="text-lg font-medium mb-3 text-primary">What is Rose Token?</h3>
          <p className="mb-3">
            ROSE is a decentralized ERC20 token with a <strong>worker distribution model</strong> that rewards participation in our task marketplace ecosystem.
          </p>
            
          {!showDetails ? (
            <button
              onClick={() => setShowDetails(true)}
              className="text-primary hover:underline mb-4"
            >
              Learn more about ROSE Token →
            </button>
          ) : (
            <div className="bg-gray-50 p-4 rounded-md mt-3">
              <h4 className="font-medium mb-2">How Rose Token Works:</h4>
              <ul className="list-disc pl-5 space-y-2 mb-4">
                <li>
                  <strong>Three Core Roles:</strong>
                  <ul className="list-circle pl-5 mt-1 space-y-1">
                    <li><strong>Customers:</strong> Create tasks by depositing ROSE tokens as payment. Your deposit is held safely in escrow until the work is completed and approved.</li>
                    <li><strong>Workers:</strong> Browse open tasks, claim work on a first-come first-served basis, complete the task, and earn 95% of the task value in ROSE tokens.</li>
                    <li><strong>Stakeholders:</strong> Stake 10% of a task's value to enable it, then validate completed work quality. Earn a 5% fee plus your stake back (50% ROI) when the task is successfully completed.</li>
                  </ul>
                </li>
                <li>
                  <strong>Task Payment Flow:</strong>
                  <ul className="list-circle pl-5 mt-1">
                    <li>Customer deposits ROSE tokens (e.g., 10 ROSE for a task)</li>
                    <li>Stakeholder stakes 10% of task value (e.g., 1 ROSE, returned on completion)</li>
                    <li>Platform mints 2% to DAO treasury separately (e.g., 0.2 ROSE)</li>
                  </ul>
                </li>
                <li>
                  <strong>Payment Distribution (on successful completion):</strong>
                  <ul className="list-circle pl-5 mt-1">
                    <li><strong>Worker receives 95%</strong> of customer's deposit (e.g., 9.5 ROSE)</li>
                    <li><strong>Stakeholder receives 5%</strong> fee + 10% stake returned (e.g., 1.5 ROSE total = 50% ROI)</li>
                    <li><strong>DAO receives 2%</strong> minted separately for governance</li>
                  </ul>
                </li>
                <li>
                  <strong>Task-Value Based:</strong> All payments scale with the task value - higher value tasks pay more ROSE tokens.
                </li>
              </ul>

              <h4 className="font-medium mb-2">Benefits:</h4>
              <ul className="list-disc pl-5 space-y-1 mb-4">
                <li>Workers earn 95% of task value in ROSE tokens</li>
                <li>Stakeholders earn 50% ROI on their stake for validating work</li>
                <li>Customer deposits held safely in escrow until work is approved</li>
                <li>Community-governed ecosystem through the DAO treasury</li>
                <li>Built on Ethereum (Sepolia testnet) for security and transparency</li>
              </ul>

              <button
                onClick={() => setShowDetails(false)}
                className="text-primary hover:underline mt-2"
              >
                Show less
              </button>
            </div>
          )}  
        </div>  
      </div>  
        
      <button  
        onClick={connectWallet}  
        className="bg-primary hover:bg-primary text-white px-6 py-3 rounded-md font-medium"  
      >  
        Connect Wallet  
      </button>  
    </div>  
  );
};

export default WalletNotConnected;
