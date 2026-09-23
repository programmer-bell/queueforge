-- 002_notify_trigger.sql — wake workers the instant work arrives.
-- Workers LISTEN on `job_available`; a slow poll (POLL_INTERVAL_MS) remains
-- the correctness fallback, so a missed notification only delays, never loses.
-- Forward-only. Safe to re-run: function is replaced, trigger is recreated.

CREATE OR REPLACE FUNCTION notify_job_available() RETURNS trigger AS $$
BEGIN
  -- Fire only when the row becomes actionable: freshly inserted actionable
  -- jobs, or updates that move a job (back) to queued / retrying.
  IF (TG_OP = 'INSERT' AND NEW.status IN ('queued', 'retrying'))
    OR (TG_OP = 'UPDATE'
        AND NEW.status IN ('queued', 'retrying')
        AND (OLD.status IS DISTINCT FROM NEW.status
             OR OLD.run_at IS DISTINCT FROM NEW.run_at)) THEN
    PERFORM pg_notify('job_available', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jobs_notify_available ON jobs;
CREATE TRIGGER trg_jobs_notify_available
  AFTER INSERT OR UPDATE OF status, run_at ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION notify_job_available();
