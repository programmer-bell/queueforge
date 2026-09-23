import type { Pool } from 'pg';
import { emitTransition } from '../events/bus.js';
import type { Job } from './types.js';

export type CancelResult =
  { outcome: 'not-found' } | { outcome: 'conflict'; job: Job } | { outcome: 'cancelled'; job: Job };

/**
 * Cancel a queued (not yet running) job. The row is locked so a concurrent
 * worker claim can't slip in between the status check and the update.
 * Anything already running / finished / dead is a 409, not a silent no-op.
 */
export async function cancelJob(db: Pool, id: string): Promise<CancelResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    try {
      const { rows } = await client.query<Job>('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [id]);
      const job = rows[0];
      if (job === undefined) {
        await client.query('ROLLBACK');
        return { outcome: 'not-found' };
      }
      if (job.status !== 'queued') {
        await client.query('ROLLBACK');
        return { outcome: 'conflict', job };
      }
      const { rows: updated } = await client.query<Job>(
        `UPDATE jobs SET status = 'cancelled', updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id],
      );
      const cancelled = updated[0] as Job;
      await client.query(
        `INSERT INTO job_events (job_id, from_status, to_status, attempt, message)
         VALUES ($1, 'queued', 'cancelled', $2, 'cancelled via API')`,
        [id, cancelled.attempts],
      );
      await client.query('COMMIT');
      emitTransition({ id, from: 'queued', to: 'cancelled', type: cancelled.type });
      return { outcome: 'cancelled', job: cancelled };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
}
