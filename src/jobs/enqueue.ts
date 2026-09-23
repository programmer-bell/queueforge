import type { Pool } from 'pg';
import { emitTransition } from '../events/bus.js';
import type { Job } from './types.js';

export interface EnqueueInput {
  type: string;
  payload: unknown;
  priority: number;
  /** When null, the job is runnable immediately (`run_at = now()`). */
  runAt: Date | null;
  maxAttempts: number;
  idempotencyKey?: string;
}

/**
 * Insert a job (plus its creation event) in one transaction.
 * Idempotency is upsert-or-return-existing: on a `idempotency_key` unique
 * violation the existing row is returned with `deduplicated: true` instead
 * of erroring, since the caller's intent (this job should exist) is already
 * satisfied. The DB trigger fires `NOTIFY job_available` on the insert, so
 * no app-level wake-up is needed here.
 */
export async function enqueueJob(
  db: Pool,
  input: EnqueueInput,
): Promise<{ job: Job; deduplicated: boolean }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    try {
      const { rows } = await client.query<Job>(
        `INSERT INTO jobs (type, payload, priority, run_at, max_attempts, idempotency_key)
         VALUES ($1, $2::jsonb, $3, COALESCE($4::timestamptz, now()), $5, $6)
         RETURNING *`,
        [
          input.type,
          JSON.stringify(input.payload ?? {}),
          input.priority,
          input.runAt?.toISOString() ?? null,
          input.maxAttempts,
          input.idempotencyKey ?? null,
        ],
      );
      const job = rows[0] as Job;
      await client.query(
        `INSERT INTO job_events (job_id, from_status, to_status, attempt)
         VALUES ($1, NULL, 'queued', 0)`,
        [job.id],
      );
      await client.query('COMMIT');
      emitTransition({ id: job.id, from: null, to: 'queued', type: job.type });
      return { job, deduplicated: false };
    } catch (err) {
      await client.query('ROLLBACK');
      if (
        input.idempotencyKey !== undefined &&
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: unknown }).code === '23505'
      ) {
        const { rows } = await db.query<Job>('SELECT * FROM jobs WHERE idempotency_key = $1', [
          input.idempotencyKey,
        ]);
        const existing = rows[0];
        if (existing === undefined) throw err;
        return { job: existing, deduplicated: true };
      }
      throw err;
    }
  } finally {
    client.release();
  }
}
