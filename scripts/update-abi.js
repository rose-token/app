const fs = require('fs');
const path = require('path');

const marketplaceArtifact = require('../artifacts/contracts/RoseMarketplace.sol/RoseMarketplace.json');
const tokenArtifact = require('../artifacts/contracts/RoseToken.sol/RoseToken.json');
const treasuryArtifact = require('../artifacts/contracts/RoseTreasury.sol/RoseTreasury.json');
const vRoseArtifact = require('../artifacts/contracts/vROSE.sol/vROSE.json');
const governanceArtifact = require('../artifacts/contracts/RoseGovernance.sol/RoseGovernance.json');
const reputationArtifact = require('../artifacts/contracts/RoseReputation.sol/RoseReputation.json');

// Output directories for both frontend and backend
const frontendTargetDir = path.join(__dirname, '../frontend/src/contracts');
const backendTargetDir = path.join(__dirname, '../backend/signer/src/abis');

// Create directories if they don't exist
[frontendTargetDir, backendTargetDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ABI file definitions
const abiFiles = [
  { name: 'RoseMarketplaceABI.json', abi: marketplaceArtifact.abi },
  { name: 'RoseTokenABI.json', abi: tokenArtifact.abi },
  { name: 'RoseTreasuryABI.json', abi: treasuryArtifact.abi },
  { name: 'vROSEABI.json', abi: vRoseArtifact.abi },
  { name: 'RoseGovernanceABI.json', abi: governanceArtifact.abi },
  { name: 'RoseReputationABI.json', abi: reputationArtifact.abi },
];

// Write ABIs to both frontend and backend directories
abiFiles.forEach(({ name, abi }) => {
  const content = JSON.stringify(abi, null, 2);
  fs.writeFileSync(path.join(frontendTargetDir, name), content);
  fs.writeFileSync(path.join(backendTargetDir, name), content);
});

console.log(`All ABIs updated successfully in:`);
console.log(`  - ${frontendTargetDir}`);
console.log(`  - ${backendTargetDir}`);
