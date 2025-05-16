import React from 'react';

const TokenDistributionChart = () => {
  const workerShare = 50;
  const stakeholderShare = 20;
  const treasuryShare = 20;
  const burnShare = 10;
  
  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200">
      <h2 className="text-xl font-semibold mb-4">Token Distribution Model</h2>
      <p className="text-sm text-gray-600 mb-4">
        When a task is successfully completed, 10% of the deposit amount is minted as bonus ROSE tokens and distributed according to the socialist model:
      </p>
      
      <div className="relative h-8 bg-gray-200 rounded-full overflow-hidden mb-4">
        <div 
          className="absolute h-full bg-green-500" 
          style={{ width: `${workerShare}%` }}
          title={`Worker: ${workerShare}%`}
        ></div>
        <div 
          className="absolute h-full bg-blue-500" 
          style={{ width: `${stakeholderShare}%`, left: `${workerShare}%` }}
          title={`Stakeholder: ${stakeholderShare}%`}
        ></div>
        <div 
          className="absolute h-full bg-purple-500" 
          style={{ width: `${treasuryShare}%`, left: `${workerShare + stakeholderShare}%` }}
          title={`Treasury: ${treasuryShare}%`}
        ></div>
        <div 
          className="absolute h-full bg-red-500" 
          style={{ width: `${burnShare}%`, left: `${workerShare + stakeholderShare + treasuryShare}%` }}
          title={`Burn: ${burnShare}%`}
        ></div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="flex items-center">
          <div className="w-4 h-4 bg-green-500 rounded-full mr-2"></div>
          <div>
            <p className="text-sm font-medium">Worker</p>
            <p className="text-xs text-gray-500">{workerShare}% of bonus tokens</p>
          </div>
        </div>
        
        <div className="flex items-center">
          <div className="w-4 h-4 bg-blue-500 rounded-full mr-2"></div>
          <div>
            <p className="text-sm font-medium">Stakeholder</p>
            <p className="text-xs text-gray-500">{stakeholderShare}% of bonus tokens</p>
          </div>
        </div>
        
        <div className="flex items-center">
          <div className="w-4 h-4 bg-purple-500 rounded-full mr-2"></div>
          <div>
            <p className="text-sm font-medium">DAO Treasury</p>
            <p className="text-xs text-gray-500">{treasuryShare}% of bonus tokens</p>
          </div>
        </div>
        
        <div className="flex items-center">
          <div className="w-4 h-4 bg-red-500 rounded-full mr-2"></div>
          <div>
            <p className="text-sm font-medium">Burned</p>
            <p className="text-xs text-gray-500">{burnShare}% of bonus tokens</p>
          </div>
        </div>
      </div>
      
      <div className="mt-4 text-sm text-gray-600">
        <p>The socialist token model ensures that rewards from completed work benefit:</p>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>The individual worker who completed the task</li>
          <li>The stakeholder who validated the work</li>
          <li>The community treasury for future development</li>
          <li>All token holders through controlled scarcity (burning)</li>
        </ul>
      </div>
    </div>
  );
};

export default TokenDistributionChart;
