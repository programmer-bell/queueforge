import { emitTransition } from '../events/bus.js';
import type { NotifyTransition, TxClient } from './claim.js';
import type { Job } from './types.js';

/** Mark a claimed job succeeded, with its transition event. Throws if the job isn't running. */
export async function completeJob(
  client: TxClient,
  jobId: string,
  notify: NotifyTransition = emitTransition,
): Promise<Job> {
  await client.query('BEGIN');
  try {
    const { rows } = await client.query<Job>(
      `UPDATE jobs
       SET status = 'succeeded', locked_by = NULL, locked_at = NULL, updated_at = now()
       WHERE id = $1 AND status = 'running'
       RETURNING *`,
      [jobId],
    );
    const job = rows[0];
    if (job === undefined) {
      await client.query('ROLLBACK');
      throw new Error(`completeJob: job ${jobId} is not running`);
    }
    await client.query(
      `INSERT INTO job_events (job_id, from_status, to_status, attempt)
       VALUES ($1, 'running', 'succeeded', $2)`,
      [jobId, job.attempts],
    );
    await client.query('COMMIT');
    notify({ id: jobId, from: 'running', to: 'succeeded', type: job.type });
    return job;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}
