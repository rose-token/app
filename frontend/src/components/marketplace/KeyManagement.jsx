import React, { useState, useEffect } from 'react';
import { generateKeyPair } from '../../utils/encryption/pgpService';

const KeyManagement = ({ account, roseMarketplace }) => {
  const [publicKey, setPublicKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
    
  useEffect(() => {
    const storedPublicKey = sessionStorage.getItem('userPublicKey');
    const storedPrivateKey = sessionStorage.getItem('userPrivateKey');
      
    if (storedPublicKey) setPublicKey(storedPublicKey);
    if (storedPrivateKey) setPrivateKey(storedPrivateKey);
  }, []);
    
  const handleGenerateKeys = async () => {
    try {
      setIsGenerating(true);
      setError('');
        
      const { publicKey: newPublicKey, privateKey: newPrivateKey } =   
        await generateKeyPair(account, `${account}@example.com`);
        
      setPublicKey(newPublicKey);
      setPrivateKey(newPrivateKey);
        
      sessionStorage.setItem('userPublicKey', newPublicKey);
      sessionStorage.setItem('userPrivateKey', newPrivateKey);
        
      const tx = await roseMarketplace.setPublicKey(newPublicKey);
      await tx.wait();
        
    } catch (err) {
      console.error('Error generating keys:', err);
      setError('Failed to generate keys');
    } finally {
      setIsGenerating(false);
    }
  };
    
  const handleImportKeys = () => {
    alert('Import functionality will be implemented in a future update.');
  };
    
  return (
    <div className="mt-6 bg-white rounded-lg shadow-sm p-4 border border-gray-200">
      <h3 className="text-lg font-semibold mb-4">PGP Key Management</h3>
        
      {!publicKey || !privateKey ? (
        <div>
          <p className="mb-4 text-sm text-gray-600">
            You need PGP keys to encrypt and decrypt task comments.   
            These keys ensure only you and the other task participants can read the comments.
          </p>
            
          <div className="flex space-x-4">
            <button
              onClick={handleGenerateKeys}
              disabled={isGenerating}
              className={`py-2 px-4 rounded-md font-medium text-white ${
                isGenerating ? 'bg-gray-400 cursor-not-allowed' : 'bg-primary hover:bg-primary/90'
              }`}
            >
              {isGenerating ? 'Generating...' : 'Generate New Keys'}
            </button>
              
            <button
              onClick={handleImportKeys}
              className="py-2 px-4 rounded-md font-medium border border-gray-300 hover:bg-gray-50"
            >
              Import Existing Keys
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-green-600 mb-4">
            ✓ You have PGP keys configured for encrypted comments
          </p>
            
          <div className="mb-4">
            <h4 className="font-medium mb-1">Your Public Key (Share this with others)</h4>
            <textarea
              value={publicKey}
              readOnly
              className="w-full h-24 p-2 border border-gray-300 rounded-md text-xs font-mono"
            />
          </div>
            
          <div className="mb-4">
            <h4 className="font-medium mb-1">Your Private Key (Keep this secret!)</h4>
            <textarea
              value="••••••••••••••••••••••••••••••••••••••••••••••••••••"
              readOnly
              className="w-full h-12 p-2 border border-gray-300 rounded-md text-xs font-mono"
            />
            <p className="text-xs text-red-500 mt-1">
              Your private key is securely stored in your browser. Never share it with anyone!
            </p>
          </div>
        </div>
      )}
        
      {error && (
        <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-md">
          {error}
        </div>
      )}
    </div>
  );
};

export default KeyManagement;
