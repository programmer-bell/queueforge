/** Row shapes mirror the `jobs` / `job_events` tables (snake_case, as `pg` returns them). */

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'retrying' | 'dead' | 'cancelled';

export interface Job {
  id: string;
  type: string;
  payload: unknown;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_at: string;
  locked_by: string | null;
  locked_at: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobEvent {
  id: number;
  job_id: string;
  from_status: string | null;
  to_status: string;
  attempt: number;
  message: string | null;
  created_at: string;
}
