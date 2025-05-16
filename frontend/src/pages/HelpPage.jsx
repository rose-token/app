import React from 'react';

const HelpPage = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Help Center</h1>
      
      <div className="grid grid-cols-1 gap-8">
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-semibold mb-4">Getting Started</h2>
          <p className="mb-4">Welcome to the Rose Token platform! Here's how to get started:</p>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-2">Connect your wallet using the "Connect Wallet" button in the header</li>
            <li className="mb-2">Browse available tasks in the Marketplace</li>
            <li className="mb-2">Check your worker statistics in the Analytics page</li>
            <li className="mb-2">Report any bugs you encounter through the Bug Reports page</li>
          </ul>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-semibold mb-4">Frequently Asked Questions</h2>
          
          <div className="mb-4">
            <h3 className="text-xl font-medium mb-2">What is Rose Token?</h3>
            <p>Rose Token is a decentralized task marketplace with a socialist token distribution model.</p>
          </div>
          
          <div className="mb-4">
            <h3 className="text-xl font-medium mb-2">How do I earn tokens?</h3>
            <p>You can earn Rose Tokens by completing tasks listed in the marketplace.</p>
          </div>
          
          <div className="mb-4">
            <h3 className="text-xl font-medium mb-2">Which networks are supported?</h3>
            <p>Currently, Rose Token operates on the Sepolia testnet.</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-semibold mb-4">Contact Support</h2>
          <p className="mb-4">If you need further assistance, please contact our support team:</p>
          <p className="mb-2"><strong>Email:</strong> support@rosetoken.example</p>
          <p><strong>Discord:</strong> Join our community at discord.gg/rosetoken</p>
        </div>
      </div>
    </div>
  );
};

export default HelpPage;
