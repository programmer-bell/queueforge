import { config } from '../config.js';
import { emitTransition } from '../events/bus.js';
import { computeBackoffSeconds } from './backoff.js';
import type { NotifyTransition, TxClient } from './claim.js';
import type { Job } from './types.js';

export interface FailOptions {
  baseDelaySec?: number;
  maxDelaySec?: number;
}

/**
 * Settle a failed run. Below `max_attempts` the job goes back to `retrying`
 * with an exponential-backoff `run_at` (so the DB trigger re-wakes workers
 * when it becomes due); at or past `max_attempts` it moves to `dead` (DLQ,
 * replayable in Phase 6). `job.attempts` is the post-claim count.
 */
export async function failJob(
  client: TxClient,
  job: Job,
  message: string,
  options: FailOptions = {},
  notify: NotifyTransition = emitTransition,
): Promise<Job> {
  const baseDelaySec = options.baseDelaySec ?? config.retryBaseDelaySeconds;
  const maxDelaySec = options.maxDelaySec ?? config.retryMaxDelaySeconds;
  const dead = job.attempts >= job.max_attempts;
  const delaySec = dead ? 0 : computeBackoffSeconds(job.attempts, baseDelaySec, maxDelaySec);

  await client.query('BEGIN');
  try {
    const { rows } = await client.query<Job>(
      `UPDATE jobs
       SET status = $2::text,
           locked_by = NULL,
           locked_at = NULL,
           last_error = $3,
           run_at = CASE WHEN $2::text = 'retrying'
                         THEN now() + make_interval(secs => $4::double precision)
                         ELSE run_at END,
           updated_at = now()
       WHERE id = $1 AND status = 'running'
       RETURNING *`,
      [job.id, dead ? 'dead' : 'retrying', message.slice(0, 2000), delaySec],
    );
    const settled = rows[0];
    if (settled === undefined) {
      await client.query('ROLLBACK');
      throw new Error(`failJob: job ${job.id} is not running`);
    }
    await client.query(
      `INSERT INTO job_events (job_id, from_status, to_status, attempt, message)
       VALUES ($1, 'running', $2, $3, $4)`,
      [job.id, settled.status, settled.attempts, message.slice(0, 2000)],
    );
    await client.query('COMMIT');
    notify({ id: job.id, from: 'running', to: settled.status, type: settled.type });
    return settled;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}
