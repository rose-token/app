const fs = require('fs');
const path = require('path');

const marketplaceArtifact = require('../artifacts/contracts/RoseMarketplace.sol/RoseMarketplace.json');
const tokenArtifact = require('../artifacts/contracts/RoseToken.sol/RoseToken.json');
const treasuryArtifact = require('../artifacts/contracts/RoseTreasury.sol/RoseTreasury.json');
const vRoseArtifact = require('../artifacts/contracts/vROSE.sol/vROSE.json');
const governanceArtifact = require('../artifacts/contracts/RoseGovernance.sol/RoseGovernance.json');
const reputationArtifact = require('../artifacts/contracts/RoseReputation.sol/RoseReputation.json');

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

fs.writeFileSync(
  path.join(targetDir, 'RoseTreasuryABI.json'),
  JSON.stringify(treasuryArtifact.abi, null, 2)
);

fs.writeFileSync(
  path.join(targetDir, 'vROSEABI.json'),
  JSON.stringify(vRoseArtifact.abi, null, 2)
);

fs.writeFileSync(
  path.join(targetDir, 'RoseGovernanceABI.json'),
  JSON.stringify(governanceArtifact.abi, null, 2)
);

fs.writeFileSync(
  path.join(targetDir, 'RoseReputationABI.json'),
  JSON.stringify(reputationArtifact.abi, null, 2)
);

console.log('All ABIs updated successfully');
