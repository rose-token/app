import React from 'react';

const TokenDistributionChart = () => {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4">Token Distribution Model</h2>
      <p className="text-sm text-muted mb-4">
        When a task is successfully completed, the platform mints 2% of the task value to the DAO treasury (separate from distribution).
        The total distribution pot (customer payment only) is distributed as follows:
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {/* Worker Card */}
        <div className="bg-background rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-primary rounded-full mr-2"></div>
              <p className="text-sm font-semibold text-muted">Worker</p>
            </div>
            <span className="text-2xl font-bold text-muted">95%</span>
          </div>
          <p className="text-xs text-muted">of distribution pot</p>
          <p className="text-xs text-muted font-medium mt-1">9.5 ROSE (for 10 ROSE task)</p>
        </div>

        {/* Stakeholder Card */}
        <div className="bg-background rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-primary rounded-full mr-2"></div>
              <p className="text-sm font-semibold text-muted">Stakeholder</p>
            </div>
            <span className="text-2xl font-bold text-muted">5%</span>
          </div>
          <p className="text-xs text-muted">fee + 10% stake back</p>
          <p className="text-xs text-muted font-medium mt-1">1.5 ROSE total (50% ROI)</p>
        </div>

        {/* DAO Treasury Card */}
        <div className="bg-background rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-primary rounded-full mr-2"></div>
              <p className="text-sm font-semibold text-muted">DAO Treasury</p>
            </div>
            <span className="text-2xl font-bold text-muted">2%</span>
          </div>
          <p className="text-xs text-muted">minted tokens</p>
          <p className="text-xs text-muted font-medium mt-1">0.2 ROSE (creates inflation)</p>
        </div>
      </div>

      <div className="mt-4 p-4 bg-card rounded-lg text-sm text-muted">
        <p className="font-medium mb-2">How it works (10 ROSE task example):</p>
        <div className="space-y-1 text-xs">
          <p>• Customer deposits: <span className="font-semibold">10 ROSE</span> (escrowed in contract)</p>
          <p>• Stakeholder stakes: <span className="font-semibold">1 ROSE</span> (10% of task value, returned on completion)</p>
          <p>• Platform mints: <span className="font-semibold">0.2 ROSE</span> → DAO treasury (separate from distribution)</p>
          <p>• Total distribution pot: <span className="font-semibold">10 ROSE</span> (customer deposit only)</p>
          <p className="pt-2 mt-2">
            The pot is distributed 95/5, with stakeholder also receiving their stake back for a 50% ROI.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TokenDistributionChart;
