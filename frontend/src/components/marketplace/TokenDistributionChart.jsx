import React from 'react';

const TokenDistributionChart = () => {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4">Token Distribution Model</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {/* Worker Card */}
        <div className="bg-background rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-primary rounded-full mr-2"></div>
              <p className="text-lg font-semibold text-muted">Worker</p>
            </div>
            <span className="text-2xl font-bold text-muted">95%</span>
          </div>
       </div>

        {/* Stakeholder Card */}
        <div className="bg-background rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-primary rounded-full mr-2"></div>
              <p className="text-lg font-semibold text-muted">Stakeholder</p>
            </div>
            <span className="text-2xl font-bold text-muted">5%</span>
          </div>
        </div>

        {/* DAO Treasury Card */}
        <div className="bg-background rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-primary rounded-full mr-2"></div>
              <p className="text-lg font-semibold text-muted">DAO Treasury</p>
            </div>
            <span className="text-2xl font-bold text-muted">2%</span>
          </div>
        </div>
      </div>

      <div className="mt-4 p-4 bg-card rounded-lg text-sm text-muted">
        <p className="font-medium mb-2">How it works (100 ROSE task example):</p>
        <div className="space-y-1 text-xs">
          <p>• Customer deposits: <span className="font-semibold">100 ROSE</span> (escrowed in contract)</p>
          <p>• Stakeholder stakes: <span className="font-semibold">10 ROSE</span> (10% of deposit, returned on completion)</p>
          <p>• Worker completes task: Receives <span className="font-semibold">95 ROSE</span> </p>
          <p>• Stakeholder verifies: Receives <span className="font-semibold">15 ROSE</span> (Returned stake + 5% of deposit)</p>
          <p>• Platform mints: DAO receives <span className="font-semibold">2 ROSE</span> (2% of deposit)</p>
        </div>
      </div>
    </div>
  );
};

export default TokenDistributionChart;
