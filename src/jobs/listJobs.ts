import type { Pool } from 'pg';
import type { Job, JobStatus } from './types.js';

export interface ListJobsFilter {
  status?: JobStatus;
  type?: string;
  page: number;
  perPage: number;
}

export interface ListJobsResult {
  jobs: Job[];
  total: number;
  page: number;
  perPage: number;
}

/**
 * Filtered, paginated job listing. `COUNT(*) OVER ()` returns the total in
 * the same round-trip as the page. Newest first.
 */
export async function listJobs(db: Pool, filter: ListJobsFilter): Promise<ListJobsResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.status !== undefined) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.type !== undefined) {
    params.push(filter.type);
    conditions.push(`type = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(filter.perPage);
  const limitParam = params.length;
  params.push((filter.page - 1) * filter.perPage);
  const offsetParam = params.length;

  const { rows } = await db.query<Job & { total: string }>(
    `SELECT *, COUNT(*) OVER () AS total FROM jobs
     ${where}
     ORDER BY created_at DESC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params,
  );
  const total = rows.length > 0 ? Number.parseInt(rows[0]?.total ?? '0', 10) : 0;
  // Explicit mapping (not `...rest`) so the COUNT(*) OVER () helper column
  // never leaks into the returned Job rows.
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
  return { jobs, total, page: filter.page, perPage: filter.perPage };
}
