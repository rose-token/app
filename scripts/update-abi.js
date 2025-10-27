const fs = require('fs');
const path = require('path');

const marketplaceArtifact = require('../artifacts/contracts/RoseMarketplace.sol/RoseMarketplace.json');
const tokenArtifact = require('../artifacts/contracts/RoseToken.sol/RoseToken.json');

const targetDir = path.join(__dirname, '../frontend/src/contracts');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

fs.writeFileSync(
  path.join(targetDir, 'RoseMarketplaceABI.json'),
  JSON.stringify(marketplaceArtifact.abi, null, 2)
);

fs.writeFileSync(
  path.join(targetDir, 'RoseTokenABI.json'),
  JSON.stringify(tokenArtifact.abi, null, 2)
);

console.log('All ABIs updated successfully');
