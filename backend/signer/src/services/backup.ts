/**
 * Database Backup Service
 *
 * Handles PostgreSQL database backup/restore using Pinata IPFS storage
 * with Hot Swaps for mutable CID references.
 *
 * Flow:
 * - Backup: pg_dump -Fc (custom format, self-compressing) → upload to Pinata → Hot Swap update
 * - Restore: Fetch from Pinata gateway → pg_restore
 */

import { spawn } from 'child_process';
import { createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { createHash, timingSafeEqual } from 'crypto';
import { PinataSDK, NetworkError } from 'pinata';
import { config } from '../config';
import path from 'path';
import os from 'os';

// Pinata gateway for URL generation
const PINATA_GATEWAY = config.backup.pinataGateway || 'https://coffee-glad-felidae-720.mypinata.cloud';

// Lazy-initialized Pinata SDK instance
let pinataInstance: PinataSDK | null = null;

/**
 * Get or create Pinata SDK instance
 */
function getPinata(): PinataSDK {
  if (!pinataInstance) {
    const jwt = config.backup.pinataJwt;
    if (!jwt) {
      throw new Error('PINATA_JWT not configured');
    }
    pinataInstance = new PinataSDK({
      pinataJwt: jwt,
      pinataGateway: new URL(PINATA_GATEWAY).hostname,
    });
  }
  return pinataInstance;
}

/**
 * Parse and validate DATABASE_URL, returning URL object
 */
function parseDatabaseUrl(): URL {
  const databaseUrl = config.database.url;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not configured');
  }

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  if (!url.hostname || !url.username || !url.pathname || url.pathname.length <= 1) {
    throw new Error('DATABASE_URL is missing required components (host, user, or database name)');
  }

  return url;
}

/**
 * Get PostgreSQL connection arguments from URL
 */
function getPgConnectionArgs(url: URL): string[] {
  return ['-h', url.hostname, '-p', url.port || '5432', '-U', url.username, '-d', url.pathname.slice(1)];
}

/**
 * Get environment variables with PostgreSQL password
 */
function getPgEnv(url: URL): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGPASSWORD: url.password || '',
  };
}

// Types
export interface BackupResult {
  success: boolean;
  cid: string;
  size: number;
  timestamp: string;
  swapUpdated: boolean;
  isFirstBackup: boolean;
  swapVerified: boolean;
}

export interface RestoreResult {
  success: boolean;
  message: string;
  cid: string;
}

export interface BackupStatus {
  referenceCid: string | null;
  isConfigured: boolean;
  lastSwap: SwapHistoryEntry | null;
}

export interface SwapHistoryEntry {
  mapped_cid: string;
  created_at: string;
}

/**
 * Get the reference CID from environment variable
 */
export function getReferenceCid(): string | null {
  return config.backup.referenceCid || null;
}

/**
 * Check if backup system is properly configured
 */
export function isBackupConfigured(): boolean {
  return Boolean(config.backup.pinataJwt) && Boolean(config.database.url);
}

/**
 * Get the gateway URL for a CID
 */
export function getGatewayUrl(cid: string): string {
  return `${PINATA_GATEWAY}/ipfs/${cid}`;
}

/**
 * Upload a file to Pinata (private, in Backups group) using SDK
 */
async function uploadToPinata(filePath: string, filename: string): Promise<{ cid: string; size: number }> {
  const pinata = getPinata();
  const stats = await fs.stat(filePath);

  // Read file into buffer and create File object
  const fileBuffer = await fs.readFile(filePath);
  const file = new File([fileBuffer], filename, { type: 'application/octet-stream' });

  // Upload using SDK with group assignment
  const response = await pinata.upload.private.file(file).group(config.backup.groupId);

  return {
    cid: response.cid,
    size: stats.size,
  };
}

/**
 * Update Hot Swap mapping: referenceCid → newCid using SDK
 */
async function updateHotSwap(referenceCid: string, newCid: string): Promise<void> {
  const pinata = getPinata();

  await pinata.files.private.addSwap({
    cid: referenceCid,
    swapCid: newCid,
  });

  console.log(`[Backup] Hot Swap updated: ${referenceCid} → ${newCid}`);
}

/**
 * Get Hot Swap history for a CID using SDK
 */
async function getSwapHistory(cid: string): Promise<SwapHistoryEntry[]> {
  const pinata = getPinata();

  try {
    const history = await pinata.files.private.getSwapHistory({
      cid,
      domain: new URL(PINATA_GATEWAY).hostname,
    });

    // SDK returns array directly with mapped_cid and created_at
    return history.map((entry) => ({
      mapped_cid: entry.mapped_cid,
      created_at: entry.created_at,
    }));
  } catch (error: unknown) {
    // Handle case where no swaps exist yet - SDK throws NetworkError with 404 status
    if (error instanceof NetworkError && error.statusCode === 404) {
      return [];
    }
    // Fallback: also check error message for backwards compatibility
    if (error instanceof Error && error.message.includes('404')) {
      return [];
    }
    throw error;
  }
}

/**
 * Execute pg_dump in custom format (already compressed internally)
 * Custom format (-Fc) is self-compressing, no need for additional gzip
 */
async function dumpDatabase(outputPath: string): Promise<void> {
  const url = parseDatabaseUrl();

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    const output = createWriteStream(outputPath);
    const pgDump = spawn('pg_dump', [...getPgConnectionArgs(url), '-Fc'], { env: getPgEnv(url) });

    let stderr = '';

    pgDump.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pgDump.on('error', (error) => {
      output.destroy();
      settle(() => reject(new Error(`pg_dump spawn error: ${error.message}`)));
    });

    // Pipe directly to file (custom format is self-compressed)
    pipeline(pgDump.stdout, output)
      .then(() => settle(() => resolve()))
      .catch((err) => settle(() => reject(stderr ? new Error(`pg_dump failed: ${stderr}`) : err)));

    pgDump.on('close', (code) => {
      if (code !== 0) {
        output.destroy();
        settle(() => reject(new Error(`pg_dump failed with code ${code}: ${stderr}`)));
      }
    });
  });
}

/**
 * Restore database from a custom format backup
 */
async function restoreDatabase(inputPath: string): Promise<void> {
  const url = parseDatabaseUrl();

  return new Promise((resolve, reject) => {
    // Use pg_restore for custom format dumps (-Fc)
    const pgRestore = spawn(
      'pg_restore',
      [...getPgConnectionArgs(url), '--clean', '--if-exists', inputPath],
      { env: getPgEnv(url) }
    );

    let stderr = '';

    pgRestore.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pgRestore.on('error', (error) => {
      reject(new Error(`pg_restore spawn error: ${error.message}`));
    });

    pgRestore.on('close', (code) => {
      // pg_restore may return non-zero for warnings, check stderr for actual errors
      if (code !== 0 && stderr.toLowerCase().includes('error')) {
        reject(new Error(`pg_restore failed with code ${code}: ${stderr}`));
      } else {
        if (stderr) {
          console.log(`[Backup] pg_restore warnings: ${stderr}`);
        }
        resolve();
      }
    });
  });
}

/**
 * Download a backup file from Pinata using SDK
 */
async function downloadBackup(cid: string, outputPath: string): Promise<void> {
  const pinata = getPinata();
  const response = await pinata.gateways.private.get(cid);

  if (!response.data) {
    throw new Error('No data received from gateway');
  }

  // Handle Blob response (binary data) or string response
  if (response.data instanceof Blob) {
    const buffer = Buffer.from(await response.data.arrayBuffer());
    await fs.writeFile(outputPath, buffer);
  } else if (typeof response.data === 'string') {
    await fs.writeFile(outputPath, response.data);
  } else {
    throw new Error(`Unexpected response type: ${typeof response.data}`);
  }
}

/**
 * Extract Buffer from Blob or string response data
 */
async function extractBlobData(data: unknown): Promise<Buffer> {
  if (data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer());
  } else if (typeof data === 'string') {
    return Buffer.from(data);
  } else {
    throw new Error(`Unexpected response type: ${typeof data}`);
  }
}

/**
 * Verify Hot Swap integrity by comparing SHA-256 hashes
 *
 * Downloads content from both reference CID (via Hot Swap redirect) and
 * the expected CID directly, computes SHA-256 hashes, and verifies they match.
 *
 * @param referenceCid - The reference CID to verify (will resolve via Hot Swap)
 * @param expectedCid - The expected target CID that Hot Swap should redirect to
 * @returns Verification result with hashes
 * @throws Error on network failures
 */
async function verifyHotSwap(
  referenceCid: string,
  expectedCid: string
): Promise<{
  working: boolean;
  referenceCid: string;
  expectedCid: string;
  referenceHash: string;
  directHash: string;
}> {
  const pinata = getPinata();

  console.log(`[Backup] Verifying Hot Swap: ${referenceCid} → ${expectedCid}`);

  // Fetch both CIDs in parallel
  const [refResponse, directResponse] = await Promise.all([
    pinata.gateways.private.get(referenceCid),
    pinata.gateways.private.get(expectedCid),
  ]);

  // Validate responses
  if (!(refResponse.data instanceof Blob) || !(directResponse.data instanceof Blob)) {
    throw new Error('Unexpected response type — expected Blob');
  }

  // Compute SHA-256 hashes
  const [referenceHash, directHash] = await Promise.all([
    extractBlobData(refResponse.data).then((buf) => createHash('sha256').update(buf).digest('hex')),
    extractBlobData(directResponse.data).then((buf) => createHash('sha256').update(buf).digest('hex')),
  ]);

  // Use timing-safe comparison to prevent timing attacks
  const working = timingSafeEqual(Buffer.from(referenceHash, 'hex'), Buffer.from(directHash, 'hex'));

  console.log(`[Backup] Reference CID:    ${referenceCid}`);
  console.log(`[Backup] Expected CID:     ${expectedCid}`);
  console.log(`[Backup] Reference hash:   ${referenceHash.slice(0, 16)}...`);
  console.log(`[Backup] Direct hash:      ${directHash.slice(0, 16)}...`);
  console.log(`[Backup] Match:            ${working ? '✅ HOT SWAP WORKING' : '❌ MISMATCH'}`);

  return {
    working,
    referenceCid,
    expectedCid,
    referenceHash,
    directHash,
  };
}

/**
 * Create a database backup
 *
 * If this is the first backup (no BACKUP_REFERENCE_CID set), returns the CID
 * which should be saved as BACKUP_REFERENCE_CID for future backups.
 *
 * If BACKUP_REFERENCE_CID is set, updates the Hot Swap mapping.
 */
export async function createBackup(): Promise<BackupResult> {
  if (!isBackupConfigured()) {
    throw new Error('Backup not configured: PINATA_JWT and DATABASE_URL required');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempPath = path.join(os.tmpdir(), `backup-${timestamp}.dump`);

  try {
    console.log('[Backup] Starting database dump...');

    // Step 1: Dump and compress database
    await dumpDatabase(tempPath);
    console.log('[Backup] Database dump completed');

    // Step 2: Upload to Pinata
    console.log('[Backup] Uploading to Pinata...');
    const { cid, size } = await uploadToPinata(tempPath, `rose-backup-${timestamp}.dump`);
    console.log(`[Backup] Uploaded: ${cid} (${(size / 1024 / 1024).toFixed(2)} MB)`);

    // Step 3: Update Hot Swap if reference CID is configured
    const referenceCid = getReferenceCid();
    let swapUpdated = false;
    let isFirstBackup = false;
    let swapVerified = false;

    if (referenceCid) {
      await updateHotSwap(referenceCid, cid);
      swapUpdated = true;
      console.log('[Backup] Hot Swap updated successfully');

      // Step 4: Wait for propagation and verify Hot Swap
      console.log('[Backup] Waiting 2s for Hot Swap propagation...');
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const verification = await verifyHotSwap(referenceCid, cid);

      if (!verification.working) {
        throw new Error(
          `Hot Swap verification failed: hash mismatch\n` +
            `  Reference CID: ${verification.referenceCid} (${verification.referenceHash})\n` +
            `  Expected CID: ${verification.expectedCid} (${verification.directHash})`
        );
      }

      swapVerified = true;
      console.log('[Backup] Hot Swap verification passed');
    } else {
      isFirstBackup = true;
      console.log('[Backup] First backup created. Add this CID as BACKUP_REFERENCE_CID:');
      console.log(`         ${cid}`);
    }

    return {
      success: true,
      cid,
      size,
      timestamp: new Date().toISOString(),
      swapUpdated,
      isFirstBackup,
      swapVerified,
    };
  } finally {
    // Cleanup temp file
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Restore database from backup
 *
 * @param cid - Optional specific CID to restore from. If not provided, uses reference CID.
 * @param confirmed - Must be true to proceed (safety check)
 */
export async function restoreBackup(cid?: string, confirmed = false): Promise<RestoreResult> {
  if (!confirmed) {
    throw new Error('Restore requires confirmation. This will overwrite the entire database.');
  }

  if (!isBackupConfigured()) {
    throw new Error('Backup not configured: PINATA_JWT and DATABASE_URL required');
  }

  const targetCid = cid || getReferenceCid();
  if (!targetCid) {
    throw new Error('No backup CID provided and BACKUP_REFERENCE_CID not configured');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempPath = path.join(os.tmpdir(), `restore-${timestamp}.dump`);

  try {
    console.log(`[Backup] Downloading backup: ${targetCid}`);

    // Step 1: Download backup
    await downloadBackup(targetCid, tempPath);
    console.log('[Backup] Download completed');

    // Step 2: Restore database
    console.log('[Backup] Restoring database...');
    await restoreDatabase(tempPath);
    console.log('[Backup] Database restored successfully');

    return {
      success: true,
      message: 'Database restored successfully',
      cid: targetCid,
    };
  } finally {
    // Cleanup temp file
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get backup status including swap history
 */
export async function getBackupStatus(): Promise<BackupStatus> {
  const referenceCid = getReferenceCid();

  let lastSwap: SwapHistoryEntry | null = null;

  if (referenceCid && config.backup.pinataJwt) {
    try {
      const history = await getSwapHistory(referenceCid);
      if (history.length > 0) {
        // Sort by created_at descending and get the latest
        lastSwap = history.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      }
    } catch (error) {
      console.warn('[Backup] Failed to fetch swap history:', error);
    }
  }

  return {
    referenceCid,
    isConfigured: isBackupConfigured(),
    lastSwap,
  };
}

export default {
  createBackup,
  restoreBackup,
  getBackupStatus,
  isBackupConfigured,
  getReferenceCid,
};
