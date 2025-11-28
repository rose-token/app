import fs from 'fs';
import path from 'path';

const WHITELIST_PATH = path.join(__dirname, '../config/whitelist.json');

interface Whitelist {
  [address: string]: number;
}

let whitelist: Whitelist = {};

function loadWhitelist(): void {
  try {
    if (fs.existsSync(WHITELIST_PATH)) {
      const data = fs.readFileSync(WHITELIST_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      // Normalize addresses to lowercase, filter out comments
      whitelist = Object.fromEntries(
        Object.entries(parsed)
          .filter(([key]) => !key.startsWith('_'))
          .map(([addr, score]) => [addr.toLowerCase(), score as number])
      );
      console.log(`Loaded whitelist with ${Object.keys(whitelist).length} addresses`);
    } else {
      console.log('No whitelist.json found, whitelist disabled');
      whitelist = {};
    }
  } catch (error) {
    console.error('Failed to load whitelist:', error);
    whitelist = {};
  }
}

// Initial load
loadWhitelist();

// Watch for changes (hot reload)
const configDir = path.dirname(WHITELIST_PATH);
if (fs.existsSync(configDir)) {
  fs.watch(configDir, (event, filename) => {
    if (filename === 'whitelist.json') {
      console.log('Whitelist file changed, reloading...');
      loadWhitelist();
    }
  });
}

export function getWhitelistedScore(address: string): number | null {
  const normalized = address.toLowerCase();
  const score = whitelist[normalized];
  return score !== undefined ? score : null;
}

export function isWhitelisted(address: string): boolean {
  return getWhitelistedScore(address) !== null;
}
