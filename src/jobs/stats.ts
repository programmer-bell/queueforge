import type { Pool } from 'pg';
import type { JobStatus } from './types.js';

export interface QueueStats {
  counts: Record<JobStatus, number>;
  /** Status transitions in the trailing 60s — the throughput signal. */
  throughputPerMin: number;
}

const ALL_STATUSES: JobStatus[] = [
  'queued',
  'running',
  'succeeded',
  'retrying',
  'dead',
  'cancelled',
];

/** Per-status queue depth + trailing-minute throughput. Two cheap indexed queries. */
export async function getStats(db: Pool): Promise<QueueStats> {
  const [{ rows: countRows }, { rows: throughputRows }] = await Promise.all([
    db.query<{ status: JobStatus; n: string }>(
      'SELECT status, COUNT(*) AS n FROM jobs GROUP BY status',
    ),
    db.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM job_events
       WHERE created_at > now() - make_interval(secs => 60)`,
    ),
  ]);
  const counts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
  for (const row of countRows) {
    counts[row.status] = Number.parseInt(row.n, 10);
  }
  return {
    counts,
    throughputPerMin: Number.parseInt(throughputRows[0]?.n ?? '0', 10),
  };
}
