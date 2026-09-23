import { Client, Pool } from 'pg';
import { config } from '../config.js';

/**
 * Shared connection pool for all API routes and job queries.
 * Raw parameterized SQL only — no ORM, no query builder.
 */
export const pool = new Pool({
  connectionString: config.databaseUrl,
});

/**
 * A dedicated client for `LISTEN job_available`.
 * Must NOT come from the pool: LISTEN state is per-connection, and pool
 * checkout/checkin would drop it. The worker pool (Phase 3) holds exactly
 * one of these for its lifetime.
 */
export async function createListener(): Promise<Client> {
  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();
  await client.query('LISTEN job_available');
  return client;
}

/** Close the pool — used by tests and graceful shutdown. */
export async function closePool(): Promise<void> {
  await pool.end();
}
