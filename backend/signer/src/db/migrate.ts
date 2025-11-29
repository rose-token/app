import * as fs from 'fs';
import * as path from 'path';
import { query, getPool } from './pool';

interface Migration {
  version: string;
  filename: string;
  sql: string;
}

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await query<{ version: string }>('SELECT version FROM schema_migrations');
  return new Set(result.rows.map((row) => row.version));
}

function getMigrationFiles(migrationsDir: string): Migration[] {
  if (!fs.existsSync(migrationsDir)) {
    console.log('No migrations directory found at:', migrationsDir);
    return [];
  }

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  return files.map((filename) => {
    const version = filename.replace('.sql', '');
    const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
    return { version, filename, sql };
  });
}

export async function runMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, '../../migrations');

  console.log('Running database migrations...');

  try {
    // Ensure migrations table exists
    await ensureMigrationsTable();

    // Get applied migrations
    const applied = await getAppliedMigrations();

    // Get migration files
    const migrations = getMigrationFiles(migrationsDir);

    if (migrations.length === 0) {
      console.log('No migrations found');
      return;
    }

    // Run pending migrations
    let count = 0;
    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }

      console.log(`Applying migration: ${migration.filename}`);

      const pool = getPool();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [
          migration.version,
        ]);
        await client.query('COMMIT');
        count++;
        console.log(`Migration ${migration.filename} applied successfully`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    if (count > 0) {
      console.log(`Applied ${count} migration(s)`);
    } else {
      console.log('Database is up to date');
    }
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  }
}
