import type { Client, PoolClient } from 'pg';
import { emitTransition, type JobTransition } from '../events/bus.js';
import type { Job } from './types.js';

/** A dedicated connection (pool checkout or standalone client) — never the pool itself. */
export type TxClient = PoolClient | Client;

export type NotifyTransition = (transition: JobTransition) => void;

/**
 * Claim one actionable job for `workerId`. Single statement, run inside a
 * transaction: the `FOR UPDATE SKIP LOCKED` row lock is what makes concurrent
 * workers never collide on the same row. Per-type concurrency limits
 * (`job_type_limits`) are resolved to a blocked-type list in the same
 * transaction — best-effort under concurrency, never a correctness gate.
 */
export async function claimJob(
  client: TxClient,
  workerId: string,
  notify: NotifyTransition = emitTransition,
): Promise<Job | null> {
  await client.query('BEGIN');
  try {
    const blocked = await client.query<{ job_type: string }>(
      `SELECT l.job_type FROM job_type_limits l
       LEFT JOIN (
         SELECT type, COUNT(*) AS running FROM jobs WHERE status = 'running' GROUP BY type
       ) r ON r.type = l.job_type
       WHERE COALESCE(r.running, 0) >= l.max_concurrency`,
    );
    const blockedTypes = blocked.rows.map((r) => r.job_type);

    const params: unknown[] = [workerId];
    let typeFilter = '';
    if (blockedTypes.length > 0) {
      params.push(blockedTypes);
      typeFilter = `AND NOT (type = ANY($${params.length}::text[]))`;
    }

    const { rows } = await client.query<Job & { old_status: string }>(
      `WITH candidate AS (
         SELECT id, status AS old_status FROM jobs
         WHERE status IN ('queued', 'retrying')
           AND run_at <= now()
           ${typeFilter}
         ORDER BY priority DESC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       ),
       updated AS (
         UPDATE jobs j
         SET status = 'running',
             locked_by = $1,
             locked_at = now(),
             attempts = attempts + 1,
             updated_at = now()
         FROM candidate c
         WHERE j.id = c.id
         RETURNING j.*, c.old_status
       )
       SELECT * FROM updated`,
      params,
    );
    const row = rows[0];
    if (row === undefined) {
      await client.query('COMMIT');
      return null;
    }
    const { old_status: _oldStatus, ...job } = row;
    await client.query('COMMIT');
    notify({ id: job.id, from: _oldStatus, to: 'running', type: job.type });
    return job;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}
