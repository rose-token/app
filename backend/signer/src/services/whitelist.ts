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

/**
 * Get all whitelisted addresses with their scores
 * @returns Copy of the whitelist object
 */
export function getAllWhitelist(): Whitelist {
  return { ...whitelist };
}

/**
 * Add or update an address in the whitelist
 * @param address - Ethereum address to add
 * @param score - Passport score override (0-100)
 */
export function addToWhitelist(address: string, score: number): void {
  const normalized = address.toLowerCase();
  whitelist[normalized] = score;
  saveWhitelist();
  console.log(`[Whitelist] Added ${normalized} with score ${score}`);
}

/**
 * Remove an address from the whitelist
 * @param address - Ethereum address to remove
 */
export function removeFromWhitelist(address: string): void {
  const normalized = address.toLowerCase();
  if (whitelist[normalized] !== undefined) {
    delete whitelist[normalized];
    saveWhitelist();
    console.log(`[Whitelist] Removed ${normalized}`);
  }
}

/**
 * Persist the whitelist to disk
 * Hot-reload will trigger automatically via fs.watch()
 */
function saveWhitelist(): void {
  try {
    const output = {
      _comment: 'Managed via Admin UI. Manual edits will trigger hot-reload.',
      ...whitelist,
    };
    fs.writeFileSync(WHITELIST_PATH, JSON.stringify(output, null, 2) + '\n');
    console.log(`[Whitelist] Saved with ${Object.keys(whitelist).length} addresses`);
  } catch (error) {
    console.error('[Whitelist] Failed to save:', error);
    throw error;
  }
}
