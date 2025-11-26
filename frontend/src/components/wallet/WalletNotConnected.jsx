import React, { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';

const WalletNotConnected = () => {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      className="rounded-[20px] backdrop-blur-[20px] p-7 mb-6 text-center transition-all duration-300"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)'
      }}
    >
      <h2 className="font-display text-2xl font-medium mb-4" style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
        Connect Your Wallet
      </h2>

      <div className="mb-6">
        <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
          Connect your wallet to create tasks, claim work, and earn ROSE tokens
        </p>

        {/* Educational content about Rose Token */}
        <div className="mt-6 text-left">
          <h3 className="font-display text-lg font-medium mb-3" style={{ color: 'var(--rose-pink)' }}>
            What is Rose Token?
          </h3>
          <p className="mb-3" style={{ color: 'var(--text-secondary)' }}>
            ROSE is a decentralized ERC20 token with a <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>worker distribution model</span> that rewards participation in our task marketplace ecosystem.
          </p>

          {!showDetails ? (
            <button
              onClick={() => setShowDetails(true)}
              className="font-medium text-sm transition-colors"
              style={{ color: 'var(--rose-pink)' }}
            >
              Learn more about ROSE Token →
            </button>
          ) : (
            <div
              className="p-5 rounded-xl mt-3"
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              <h4 className="font-medium mb-3" style={{ color: 'var(--text-primary)' }}>How Rose Token Works:</h4>
              <ul className="space-y-3 mb-4">
                <li>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Three Core Roles:</span>
                  <ul className="pl-5 mt-2 space-y-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <li>• <span style={{ color: 'var(--rose-pink)' }}>Customers:</span> Create tasks by depositing ROSE tokens as payment</li>
                    <li>• <span style={{ color: 'var(--info)' }}>Workers:</span> Browse tasks, complete work, and earn 95% of the task value</li>
                    <li>• <span style={{ color: 'var(--warning)' }}>Stakeholders:</span> Stake 10% to enable tasks and earn 5% fee (50% ROI)</li>
                  </ul>
                </li>
                <li>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Payment Distribution:</span>
                  <ul className="pl-5 mt-2 space-y-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <li>• Worker receives <span style={{ color: 'var(--success)' }}>95%</span> of customer's deposit</li>
                    <li>• Stakeholder receives <span style={{ color: 'var(--success)' }}>5%</span> fee + stake returned</li>
                    <li>• DAO receives <span style={{ color: 'var(--success)' }}>2%</span> minted separately</li>
                  </ul>
                </li>
              </ul>

              <button
                onClick={() => setShowDetails(false)}
                className="text-sm font-medium transition-colors"
                style={{ color: 'var(--rose-pink)' }}
              >
                Show less
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-center">
        <ConnectButton />
      </div>
    </div>
  );
};

export default WalletNotConnected;
