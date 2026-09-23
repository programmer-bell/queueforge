import type { Pool } from 'pg';
import type { Job, JobEvent } from './types.js';

export interface JobDetail {
  job: Job;
  events: JobEvent[];
}

/** Job detail plus its full append-only event timeline, oldest first. */
export async function getJobDetail(db: Pool, id: string): Promise<JobDetail | null> {
  const { rows } = await db.query<Job>('SELECT * FROM jobs WHERE id = $1', [id]);
  const job = rows[0];
  if (job === undefined) return null;
  const events = await db.query<JobEvent>(
    'SELECT * FROM job_events WHERE job_id = $1 ORDER BY id ASC',
    [id],
  );
  return { job, events: events.rows };
}
