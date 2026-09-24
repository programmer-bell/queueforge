import { CronExpressionParser } from 'cron-parser';
import type { Pool } from 'pg';

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  job_type: string;
  payload_template: unknown;
  priority: number;
  max_attempts: number;
  enabled: boolean;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateScheduleInput {
  name: string;
  cron: string;
  jobType: string;
  payloadTemplate: unknown;
  priority: number;
  maxAttempts: number;
}

export interface ListSchedulesResult {
  schedules: Schedule[];
  total: number;
  page: number;
  perPage: number;
}

/** True when `cron-parser` accepts the expression (5-field standard cron). */
export function isValidCron(cron: string): boolean {
  if (cron.trim() === '') return false;
  try {
    CronExpressionParser.parse(cron);
    return true;
  } catch {
    return false;
  }
}

/** Next fire time strictly after `after`, or null when unparseable. */
export function nextRunAfter(cron: string, after: Date): Date | null {
  try {
    const next = CronExpressionParser.parse(cron, { currentDate: after }).next();
    return next.toDate();
  } catch {
    return null;
  }
}

const SCHEDULE_COLUMNS =
  'id, name, cron, job_type, payload_template, priority, max_attempts, enabled, last_run_at, created_at, updated_at';

export async function createSchedule(db: Pool, input: CreateScheduleInput): Promise<Schedule> {
  const { rows } = await db.query<Schedule>(
    `INSERT INTO schedules (name, cron, job_type, payload_template, priority, max_attempts, enabled)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, true)
     RETURNING ${SCHEDULE_COLUMNS}`,
    [
      input.name,
      input.cron,
      input.jobType,
      JSON.stringify(input.payloadTemplate ?? {}),
      input.priority,
      input.maxAttempts,
    ],
  );
  return rows[0] as Schedule;
}

export async function listSchedules(
  db: Pool,
  page: number,
  perPage: number,
): Promise<ListSchedulesResult> {
  const { rows } = await db.query<Schedule & { total: string }>(
    `SELECT ${SCHEDULE_COLUMNS}, COUNT(*) OVER () AS total FROM schedules
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [perPage, (page - 1) * perPage],
  );
  const total = rows.length > 0 ? Number.parseInt(rows[0]?.total ?? '0', 10) : 0;
  const schedules: Schedule[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    cron: row.cron,
    job_type: row.job_type,
    payload_template: row.payload_template,
    priority: row.priority,
    max_attempts: row.max_attempts,
    enabled: row.enabled,
    last_run_at: row.last_run_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  return { schedules, total, page, perPage };
}

export type SetEnabledResult =
  { outcome: 'not-found' } | { outcome: 'updated'; schedule: Schedule };

export async function setScheduleEnabled(
  db: Pool,
  id: string,
  enabled: boolean,
): Promise<SetEnabledResult> {
  const { rows } = await db.query<Schedule>(
    `UPDATE schedules SET enabled = $2, updated_at = now()
     WHERE id = $1 RETURNING ${SCHEDULE_COLUMNS}`,
    [id, enabled],
  );
  const schedule = rows[0];
  if (schedule === undefined) return { outcome: 'not-found' };
  return { outcome: 'updated', schedule };
}
