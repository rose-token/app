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
import { createWriteStream, createReadStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import axios from 'axios';
import FormData from 'form-data';
import { config } from '../config';
import path from 'path';
import os from 'os';

// Pinata V3 API endpoints
const PINATA_UPLOAD_URL = 'https://uploads.pinata.cloud/v3/files';
const PINATA_SWAP_URL = 'https://api.pinata.cloud/v3/files/private/swap';
const PINATA_GATEWAY = process.env.PINATA_GATEWAY || 'https://coffee-glad-felidae-720.mypinata.cloud';

// Types
export interface BackupResult {
  success: boolean;
  cid: string;
  size: number;
  timestamp: string;
  swapUpdated: boolean;
  isFirstBackup: boolean;
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
 * Upload a file to Pinata V3 API (private, in Backups group)
 */
async function uploadToPinata(filePath: string, filename: string): Promise<{ cid: string; size: number }> {
  const jwt = config.backup.pinataJwt;
  if (!jwt) {
    throw new Error('PINATA_JWT not configured');
  }

  const formData = new FormData();
  const fileStream = createReadStream(filePath);
  const stats = await fs.stat(filePath);

  formData.append('file', fileStream, { filename });
  formData.append('network', 'private');
  formData.append('group_id', config.backup.groupId);

  const response = await axios.post(PINATA_UPLOAD_URL, formData, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      ...formData.getHeaders(),
    },
    maxBodyLength: Infinity,
    timeout: 5 * 60 * 1000, // 5 minute timeout for large backups
  });

  return {
    cid: response.data.data.cid,
    size: stats.size,
  };
}

/**
 * Update Hot Swap mapping: referenceCid → newCid
 */
async function updateHotSwap(referenceCid: string, newCid: string): Promise<void> {
  const jwt = config.backup.pinataJwt;
  if (!jwt) {
    throw new Error('PINATA_JWT not configured');
  }

  await axios.put(
    `${PINATA_SWAP_URL}/${referenceCid}`,
    { swapCid: newCid },
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
    }
  );

  console.log(`[Backup] Hot Swap updated: ${referenceCid} → ${newCid}`);
}

/**
 * Get Hot Swap history for a CID
 */
async function getSwapHistory(cid: string): Promise<SwapHistoryEntry[]> {
  const jwt = config.backup.pinataJwt;
  if (!jwt) {
    throw new Error('PINATA_JWT not configured');
  }

  try {
    const response = await axios.get(`${PINATA_SWAP_URL}/${cid}?domain=${new URL(PINATA_GATEWAY).hostname}`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });

    return response.data.data || [];
  } catch (error: unknown) {
    // 404 means no swaps yet - that's OK
    if (axios.isAxiosError(error) && error.response?.status === 404) {
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
  const databaseUrl = config.database.url;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not configured');
  }

  // Validate URL before using
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  if (!url.hostname || !url.username || !url.pathname || url.pathname.length <= 1) {
    throw new Error('DATABASE_URL is missing required components (host, user, or database name)');
  }

  return new Promise((resolve, reject) => {
    let resolved = false;
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
      }
    };

    const env = {
      ...process.env,
      PGPASSWORD: url.password || '',
    };

    const output = createWriteStream(outputPath);

    const pgDump = spawn(
      'pg_dump',
      ['-h', url.hostname, '-p', url.port || '5432', '-U', url.username, '-d', url.pathname.slice(1), '-Fc'],
      { env }
    );

    let stderr = '';

    pgDump.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pgDump.on('error', (error) => {
      cleanup();
      output.destroy();
      reject(new Error(`pg_dump spawn error: ${error.message}`));
    });

    // Pipe directly to file (custom format is self-compressed)
    pipeline(pgDump.stdout, output)
      .then(() => {
        cleanup();
        resolve();
      })
      .catch((err) => {
        cleanup();
        // Check if pg_dump had an error
        if (stderr) {
          reject(new Error(`pg_dump failed: ${stderr}`));
        } else {
          reject(err);
        }
      });

    pgDump.on('close', (code) => {
      if (code !== 0 && !resolved) {
        cleanup();
        output.destroy();
        reject(new Error(`pg_dump failed with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Restore database from a custom format backup
 */
async function restoreDatabase(inputPath: string): Promise<void> {
  const databaseUrl = config.database.url;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not configured');
  }

  // Validate URL before using
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  if (!url.hostname || !url.username || !url.pathname || url.pathname.length <= 1) {
    throw new Error('DATABASE_URL is missing required components (host, user, or database name)');
  }

  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PGPASSWORD: url.password || '',
    };

    // Use pg_restore for custom format dumps (-Fc)
    const pgRestore = spawn(
      'pg_restore',
      [
        '-h',
        url.hostname,
        '-p',
        url.port || '5432',
        '-U',
        url.username,
        '-d',
        url.pathname.slice(1),
        '--clean', // Drop objects before recreating
        '--if-exists', // Don't error if objects don't exist
        inputPath, // Custom format file (not gzipped)
      ],
      { env }
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
 * Download a backup file from Pinata
 * Note: Private files require Authorization header
 */
async function downloadBackup(cid: string, outputPath: string): Promise<void> {
  const jwt = config.backup.pinataJwt;
  if (!jwt) {
    throw new Error('PINATA_JWT not configured');
  }

  const response = await axios.get(getGatewayUrl(cid), {
    responseType: 'stream',
    timeout: 5 * 60 * 1000, // 5 minute timeout
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  });

  const output = createWriteStream(outputPath);
  await pipeline(response.data, output);
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

    if (referenceCid) {
      await updateHotSwap(referenceCid, cid);
      swapUpdated = true;
      console.log('[Backup] Hot Swap updated successfully');
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
