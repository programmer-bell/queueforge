import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Minimal migration runner — a `migrations` tracking table + apply-in-order.
 * No framework. Each `*.sql` file runs inside its own transaction and is
 * recorded by filename, so re-runs only apply new files. The SQL files
 * themselves are also `IF NOT EXISTS`-safe for clean local-dev restarts.
 */
export function migrationsDir(): string {
  // src/db/migrate.ts under tsx  ->  src/db/migrations
  // dist/db/migrate.js in Docker ->  dist/db/migrations (Dockerfile copies them there)
  return join(dirname(fileURLToPath(import.meta.url)), 'migrations');
}

export async function migrate(databaseUrl: string = config.databaseUrl): Promise<string[]> {
  const dir = migrationsDir();
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const applied = await client.query<{ filename: string }>('SELECT filename FROM migrations');
    const appliedSet = new Set(applied.rows.map((r) => r.filename));
    const pending = files.filter((f) => !appliedSet.has(f));
    for (const file of pending) {
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      logger.info({ file }, 'migration applied');
    }
    return pending;
  } finally {
    await client.end();
  }
}

const isMainModule =
  process.argv[1]?.endsWith('migrate.ts') === true ||
  process.argv[1]?.endsWith('migrate.js') === true;

if (isMainModule) {
  try {
    const applied = await migrate();
    logger.info(
      { count: applied.length },
      applied.length === 0 ? 'no migrations to apply' : 'migrations complete',
    );
  } catch (err) {
    logger.error({ err }, 'migration failed');
    process.exitCode = 1;
  }
}
