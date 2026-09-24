import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { logger } from '../logger.js';
import { enqueueJob } from './enqueue.js';
import { nextRunAfter, type Schedule } from './schedules.js';

const log = logger.child({ component: 'scheduler' });

let timer: NodeJS.Timeout | null = null;

/**
 * One scheduler pass: for every enabled schedule, fire when the next cron
 * occurrence after `last_run_at` (or creation, if never fired) is due.
 * The row is locked and `last_run_at` advanced *before* enqueueing, so a
 * crash between the two skips one occurrence rather than double-firing.
 * Returns the enqueued job ids. Exported for tests; the interval calls it.
 */
export async function tickOnce(now: Date = new Date()): Promise<string[]> {
  const client = await pool.connect();
  let due: Schedule[];
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<Schedule>(
      `SELECT * FROM schedules WHERE enabled = true FOR UPDATE SKIP LOCKED`,
    );
    due = rows.filter((s) => {
      const reference = s.last_run_at ? new Date(s.last_run_at) : new Date(s.created_at);
      const next = nextRunAfter(s.cron, reference);
      return next !== null && next.getTime() <= now.getTime();
    });
    for (const s of due) {
      await client.query('UPDATE schedules SET last_run_at = $1 WHERE id = $2', [
        now.toISOString(),
        s.id,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const jobIds: string[] = [];
  for (const s of due) {
    try {
      const { job } = await enqueueJob(pool, {
        type: s.job_type,
        payload: s.payload_template,
        priority: s.priority,
        runAt: null,
        maxAttempts: s.max_attempts,
      });
      jobIds.push(job.id);
      log.info({ scheduleId: s.id, jobId: job.id }, 'scheduled job enqueued');
    } catch (err) {
      log.error({ err, scheduleId: s.id }, 'failed to enqueue scheduled job');
    }
  }
  return jobIds;
}

/** Start the in-process cron ticker (server boot). Idempotent. */
export function startScheduler(intervalMs: number = config.schedulerTickMs): void {
  if (timer !== null) return;
  const tick = (): void => {
    tickOnce().catch((err: unknown) => {
      log.warn({ err }, 'scheduler tick failed, will retry on next interval');
    });
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  log.info({ intervalMs }, 'scheduler started');
}

export function stopScheduler(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}
