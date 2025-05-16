const fs = require('fs');
const path = require('path');

const contractArtifact = require('../artifacts/contracts/RoseMarketplace.sol/RoseMarketplace.json');
const abi = contractArtifact.abi;

const targetDir = path.join(__dirname, '../frontend/src/contracts');
fs.writeFileSync(
  path.join(targetDir, 'RoseMarketplaceABI.json'),
  JSON.stringify(abi, null, 2)
);

console.log('ABI updated successfully');
