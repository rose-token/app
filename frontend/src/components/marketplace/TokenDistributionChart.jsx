import React from 'react';

const TokenDistributionChart = () => {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200">
      <h2 className="text-xl font-semibold mb-4">Token Distribution Model</h2>
      <p className="text-sm text-gray-600 mb-4">
        When a task is successfully completed, the platform mints 2% of the task value to the DAO treasury (separate from distribution).
        The total distribution pot (customer payment only) is distributed as follows:
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {/* Worker Card */}
        <div className="bg-green-50 border-2 border-green-500 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
              <p className="text-sm font-semibold text-green-900">Worker</p>
            </div>
            <span className="text-2xl font-bold text-green-700">95%</span>
          </div>
          <p className="text-xs text-gray-600">of distribution pot</p>
          <p className="text-xs text-green-700 font-medium mt-1">9.5 ROSE (for 10 ROSE task)</p>
        </div>

        {/* Stakeholder Card */}
        <div className="bg-blue-50 border-2 border-blue-500 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
              <p className="text-sm font-semibold text-blue-900">Stakeholder</p>
            </div>
            <span className="text-2xl font-bold text-blue-700">5%</span>
          </div>
          <p className="text-xs text-gray-600">fee + 10% stake back</p>
          <p className="text-xs text-blue-700 font-medium mt-1">1.5 ROSE total (50% ROI)</p>
        </div>

        {/* DAO Treasury Card */}
        <div className="bg-purple-50 border-2 border-purple-500 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-purple-500 rounded-full mr-2"></div>
              <p className="text-sm font-semibold text-purple-900">DAO Treasury</p>
            </div>
            <span className="text-2xl font-bold text-purple-700">2%</span>
          </div>
          <p className="text-xs text-gray-600">minted tokens</p>
          <p className="text-xs text-purple-700 font-medium mt-1">0.2 ROSE (creates inflation)</p>
        </div>
      </div>

      <div className="mt-4 p-4 bg-gray-50 rounded-lg text-sm text-gray-700">
        <p className="font-medium mb-2">How it works (10 ROSE task example):</p>
        <div className="space-y-1 text-xs">
          <p>• Customer deposits: <span className="font-semibold">10 ROSE</span> (escrowed in contract)</p>
          <p>• Stakeholder stakes: <span className="font-semibold">1 ROSE</span> (10% of task value, returned on completion)</p>
          <p>• Platform mints: <span className="font-semibold">0.2 ROSE</span> → DAO treasury (separate from distribution)</p>
          <p>• Total distribution pot: <span className="font-semibold">10 ROSE</span> (customer deposit only)</p>
          <p className="pt-2 border-t border-gray-300 mt-2">
            The pot is distributed 95/5, with stakeholder also receiving their stake back for a 50% ROI.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TokenDistributionChart;
