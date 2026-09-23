-- 003_schedules.sql — recurring job definitions + per-type concurrency limits.
-- Forward-only. Safe to re-run: every object is created IF NOT EXISTS.

-- Cron-style recurring jobs. The in-process scheduler (Phase 7) ticks over
-- enabled rows and enqueues a job instance whenever one is due.
CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  job_type TEXT NOT NULL,
  payload_template JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules (enabled);

-- Optional per-job-type max concurrency overrides. Absent row (or NULL) =
-- no limit. Read by the worker pool (Phase 3) so one noisy type can't
-- starve the others.
CREATE TABLE IF NOT EXISTS job_type_limits (
  job_type TEXT PRIMARY KEY,
  max_concurrency INTEGER NOT NULL CHECK (max_concurrency > 0)
);
