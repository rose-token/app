import { Pool, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';
import { withRetry } from '../utils/retry';

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

  await withRetry(
    async () => {
      // Reset pool before each attempt to avoid cached bad state
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
