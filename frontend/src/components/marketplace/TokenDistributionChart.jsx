import React from 'react';

const TokenDistributionChart = () => {
  const workerShare = 93;
  const stakeholderShare = 5;
  const treasuryShare = 2;

  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200">
      <h2 className="text-xl font-semibold mb-4">Token Distribution Model</h2>
      <p className="text-sm text-gray-600 mb-4">
        When a task is successfully completed, the platform mints 2% of the task value to the DAO treasury.
        The total distribution pot (customer payment + minted tokens) is distributed as follows:
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
          title={`DAO Treasury: ${treasuryShare}%`}
        ></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="flex items-center">
          <div className="w-4 h-4 bg-green-500 rounded-full mr-2"></div>
          <div>
            <p className="text-sm font-medium">Worker</p>
            <p className="text-xs text-gray-500">{workerShare}% of distribution pot</p>
          </div>
        </div>

        <div className="flex items-center">
          <div className="w-4 h-4 bg-blue-500 rounded-full mr-2"></div>
          <div>
            <p className="text-sm font-medium">Stakeholder</p>
            <p className="text-xs text-gray-500">{stakeholderShare}% fee + 10% stake back</p>
          </div>
        </div>

        <div className="flex items-center">
          <div className="w-4 h-4 bg-purple-500 rounded-full mr-2"></div>
          <div>
            <p className="text-sm font-medium">DAO Treasury</p>
            <p className="text-xs text-gray-500">{treasuryShare}% minted tokens</p>
          </div>
        </div>


      </div>

      <div className="mt-4 text-sm text-gray-600">
        <p className="font-medium mb-2">Example: 10 ROSE task</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Customer deposits: 10 ROSE (escrowed)</li>
          <li>Stakeholder stakes: 1 ROSE (10% of task value)</li>
          <li>Platform mints: 0.2 ROSE to DAO treasury</li>
          <li>Distribution pot: 10.2 ROSE (deposit + minted)</li>
          <li>Worker receives: 9.486 ROSE (93% of pot)</li>
          <li>Stakeholder receives: 1.51 ROSE total (1.0 stake + 0.51 fee = 51% ROI)</li>
        </ul>
      </div>
    </div>
  );
};

export default TokenDistributionChart;
