/**
 * Database Service
 *
 * Administrative database operations including truncation.
 * DANGER: These operations are destructive and irreversible.
 */

import { query, getPool } from '../db/pool';

/** Tables that should NEVER be truncated */
const PROTECTED_TABLES = ['schema_migrations'];

export interface TruncateResult {
  tables: string[];
  count: number;
}

/**
 * Get all user tables in the database (excluding system tables).
 * Filters out protected tables like schema_migrations.
 */
export async function getTruncatableTables(): Promise<string[]> {
  const result = await query<{ tablename: string }>(
    `SELECT tablename
     FROM pg_catalog.pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename`
  );

  return result.rows
    .map((row) => row.tablename)
    .filter((table) => !PROTECTED_TABLES.includes(table));
}

/**
 * Truncate all tables in the database except protected ones.
 * Uses TRUNCATE ... CASCADE to handle any foreign key relationships.
 *
 * WARNING: This is a destructive operation that cannot be undone.
 * Always create a backup before calling this function.
 *
 * @returns Object with truncated table names and count
 */
export async function truncateAllTables(): Promise<TruncateResult> {
  console.log('[Database] Starting truncation of all tables...');

  // Get list of tables to truncate
  const tables = await getTruncatableTables();

  if (tables.length === 0) {
    console.log('[Database] No tables to truncate');
    return { tables: [], count: 0 };
  }

  console.log(`[Database] Found ${tables.length} tables to truncate:`, tables);

  // Truncate all tables in a single transaction
  // Using TRUNCATE ... CASCADE handles any FK relationships
  const tableList = tables.map((t) => `"${t}"`).join(', ');

  // IMPORTANT: Use dedicated client for transaction to ensure all queries
  // run on the same connection (pool.query() can use different connections)
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Temporarily disable triggers to avoid issues with update triggers
    await client.query('SET session_replication_role = replica');

    // Truncate all tables at once with CASCADE
    await client.query(`TRUNCATE TABLE ${tableList} CASCADE`);

    // Re-enable triggers
    await client.query('SET session_replication_role = DEFAULT');

    await client.query('COMMIT');

    console.log(`[Database] Successfully truncated ${tables.length} tables`);
    return { tables, count: tables.length };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Database] Truncation failed, rolled back:', error);
    throw error;
  } finally {
    client.release();
  }
}
