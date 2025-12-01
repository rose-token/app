import { Pool, QueryResult, QueryResultRow } from 'pg';
import * as net from 'net';
import * as dns from 'dns';
import { promisify } from 'util';
import { config } from '../config';
import { withRetry } from '../utils/retry';

const dnsLookup = promisify(dns.lookup);

/**
 * Parse host and port from DATABASE_URL
 */
function parseDatabaseUrl(url: string): { host: string; port: number } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 5432,
    };
  } catch {
    return { host: 'localhost', port: 5432 };
  }
}

/**
 * Check if hostname resolves via DNS.
 * Returns resolved IP or null if DNS fails.
 */
async function checkDnsResolution(host: string): Promise<string | null> {
  try {
    const result = await dnsLookup(host);
    return result.address;
  } catch {
    return null;
  }
}

/**
 * Check raw TCP connectivity to a host:port.
 * Returns true if connection succeeds, false otherwise.
 */
function checkTcpConnectivity(host: string, port: number, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      console.log(`TCP timeout to ${host}:${port} after ${timeout}ms`);
      socket.destroy();
      resolve(false);
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      console.log(`TCP error to ${host}:${port}: ${err.code} - ${err.message}`);
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    if (!config.database.url) {
      throw new Error('DATABASE_URL is not configured');
    }

    pool = new Pool({
      connectionString: config.database.url,
      max: config.database.pool.max,
      min: config.database.pool.min,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: config.database.pool.connectionTimeoutMs,
      // TCP keepalive to detect dead connections faster
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
  }

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const pool = getPool();
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;

  if (duration > 100) {
    console.log('Slow query:', { text: text.substring(0, 50), duration, rows: result.rowCount });
  }

  return result;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Resets the pool by destroying it. Used during connection retries
 * to avoid cached bad state in the Pool object.
 */
export function resetPool(): void {
  if (pool) {
    pool.end().catch(() => {}); // Best effort cleanup, don't block
    pool = null;
  }
}

/**
 * Waits for database to be available with exponential backoff retry.
 * First checks TCP connectivity, then attempts PostgreSQL connection.
 * Use this at startup before running migrations.
 */
export async function waitForDatabase(): Promise<void> {
  console.log('Waiting for database connection...');

  // Optional startup delay to let postgres initialize (useful for Akash where depends_on doesn't wait for health)
  const startupDelay = config.database.retry.startupDelayMs;
  if (startupDelay > 0) {
    console.log(`Waiting ${startupDelay}ms for database to start...`);
    await new Promise((resolve) => setTimeout(resolve, startupDelay));
  }

  const { host, port } = parseDatabaseUrl(config.database.url);
  const tcpTimeout = 5000; // 5 second TCP check timeout

  await withRetry(
    async () => {
      // Step 1: Check DNS resolution
      const resolvedIp = await checkDnsResolution(host);
      if (!resolvedIp) {
        throw new Error(`DNS resolution for ${host} failed`);
      }
      console.log(`DNS resolved ${host} → ${resolvedIp}`);

      // Step 2: Check raw TCP connectivity (faster failure detection)
      const tcpReachable = await checkTcpConnectivity(resolvedIp, port, tcpTimeout);
      if (!tcpReachable) {
        throw new Error(`TCP connection to ${resolvedIp}:${port} failed`);
      }
      console.log(`TCP connection to ${resolvedIp}:${port} succeeded`);

      // Step 3: PostgreSQL connection test
      resetPool();
      const p = getPool();
      const client = await p.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
    },
    {
      maxRetries: config.database.retry.maxRetries,
      initialDelayMs: config.database.retry.initialDelayMs,
      maxDelayMs: config.database.retry.maxDelayMs,
      onRetry: (attempt, error, delay) => {
        console.log(`Database connection attempt ${attempt} failed: ${error.message}`);
        console.log(`Retrying in ${delay}ms...`);
      },
    }
  );

  console.log('Database connected successfully');
}
