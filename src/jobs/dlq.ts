import type { Pool, PoolClient } from 'pg';
import { emitTransition } from '../events/bus.js';
import type { NotifyTransition } from './claim.js';
import type { Job } from './types.js';

export interface ListDeadResult {
  jobs: Job[];
  total: number;
  page: number;
  perPage: number;
}

/** Dead-letter listing: most recently dead first, paginated. */
export async function listDeadJobs(
  db: Pool,
  page: number,
  perPage: number,
): Promise<ListDeadResult> {
  const { rows } = await db.query<Job & { total: string }>(
    `SELECT *, COUNT(*) OVER () AS total FROM jobs
     WHERE status = 'dead'
     ORDER BY updated_at DESC
     LIMIT $1 OFFSET $2`,
    [perPage, (page - 1) * perPage],
  );
  const total = rows.length > 0 ? Number.parseInt(rows[0]?.total ?? '0', 10) : 0;
  const jobs: Job[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    max_attempts: row.max_attempts,
    run_at: row.run_at,
    locked_by: row.locked_by,
    locked_at: row.locked_at,
    last_error: row.last_error,
    idempotency_key: row.idempotency_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  return { jobs, total, page, perPage };
}

export type ReplayResult =
  { outcome: 'not-found' } | { outcome: 'conflict'; job: Job } | { outcome: 'replayed'; job: Job };

/**
 * Move a dead job back to `queued` with attempts reset, runnable immediately.
 * The row is locked so a concurrent transition can't slip in; only `dead`
 * jobs are replayable. The DB trigger fires `NOTIFY job_available` on the
 * move back to `queued`, so workers wake without any app-level poke.
 */
export async function replayJob(
  db: Pool,
  id: string,
  notify: NotifyTransition = emitTransition,
): Promise<ReplayResult> {
  const client: PoolClient = await db.connect();
  try {
    await client.query('BEGIN');
    try {
      const { rows } = await client.query<Job>('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [id]);
      const job = rows[0];
      if (job === undefined) {
        await client.query('ROLLBACK');
        return { outcome: 'not-found' };
      }
      if (job.status !== 'dead') {
        await client.query('ROLLBACK');
        return { outcome: 'conflict', job };
      }
      const { rows: updated } = await client.query<Job>(
        `UPDATE jobs
         SET status = 'queued', attempts = 0, locked_by = NULL, locked_at = NULL,
             run_at = now(), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id],
      );
      const replayed = updated[0] as Job;
      await client.query(
        `INSERT INTO job_events (job_id, from_status, to_status, attempt, message)
         VALUES ($1, 'dead', 'queued', 0, 'replayed from DLQ via API')`,
        [id],
      );
      await client.query('COMMIT');
      notify({ id, from: 'dead', to: 'queued', type: replayed.type });
      return { outcome: 'replayed', job: replayed };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
}
