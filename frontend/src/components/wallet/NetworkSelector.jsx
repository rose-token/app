import React from 'react';
import { useSwitchChain, useChainId } from 'wagmi';

const NetworkSelector = () => {
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  
  const networks = [
    { id: 1, name: 'Ethereum Mainnet' },
    { id: 11155111, name: 'Sepolia Testnet' }
  ];

  const currentNetwork = networks.find(network => network.id === chainId) || { name: 'Unknown Network' };

  return (
    <div className="relative">
      <select
        value={chainId || ''}
        onChange={(e) => switchChain?.({ chainId: parseInt(e.target.value) })}
        className="bg-white text-primary hover:bg-opacity-90 px-4 py-2 rounded-md font-medium appearance-none cursor-pointer pr-8"
      >
        <option value={currentNetwork.id}>{currentNetwork.name}</option>
        {networks
          .filter(network => network.id !== chainId)
          .map(network => (
            <option key={network.id} value={network.id}>
              {network.name}
            </option>
          ))}
      </select>
      <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
        <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
        </svg>
      </div>
    </div>
  );
};

export default NetworkSelector;
