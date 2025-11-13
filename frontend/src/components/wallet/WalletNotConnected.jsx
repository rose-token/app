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
                  <ul className="list-circle pl-5 mt-1">  
                    <li><strong>Customers:</strong> Create tasks with ETH deposits</li>  
                    <li><strong>Workers:</strong> Claim and complete tasks</li>  
                    <li><strong>Stakeholders:</strong> Validate work and arbitrate disputes</li>  
                  </ul>  
                </li>  
                <li>  
                  <strong>Worker Token Distribution:</strong> When tasks are completed successfully, new ROSE tokens are minted and distributed:  
                  <ul className="list-circle pl-5 mt-1">  
                    <li>95% to the worker who completed the task</li>  
                    <li>5% to the stakeholder who validated the work</li>  
                    <li>2% minted to a DAO treasury for community governance</li>  
                  </ul>  
                </li>  
                <li>  
                  <strong>Reputation System:</strong> Earn experience points and unlock minting bonuses as you participate in the ecosystem.  
                </li>  
              </ul>  
                
              <h4 className="font-medium mb-2">Benefits:</h4>  
              <ul className="list-disc pl-5 space-y-1 mb-4">  
                <li>Earn ROSE tokens by contributing your skills and validating work</li>  
                <li>Fair distribution model that rewards all participants</li>  
                <li>Community-governed ecosystem through the DAO treasury</li>  
                <li>Built on Ethereum for security and transparency</li>  
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
        className="bg-primary hover:bg-primary/90 text-white px-6 py-3 rounded-md font-medium"  
      >  
        Connect Wallet  
      </button>  
    </div>  
  );
};

export default WalletNotConnected;
