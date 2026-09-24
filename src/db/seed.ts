import { Client } from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Seed script — inserts a handful of jobs in various states for demo / first-run
 * screenshots. Idempotent: skips if the `jobs` table already has rows.
 *
 * Usage:
 *   npx tsx src/db/seed.ts          # local dev
 *   npm run seed                    # via package.json script
 */

interface SeedJob {
  type: string;
  payload: Record<string, unknown>;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_at_offset_min: number; // minutes relative to now (negative = past)
  locked_by: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  events: Array<{
    from: string | null;
    to: string;
    attempt: number;
    message: string | null;
    offset_min: number; // minutes relative to now
  }>;
}

const SEED_JOBS: SeedJob[] = [
  // 1. Queued — waiting to be claimed
  {
    type: 'email.send',
    payload: { to: 'alice@example.com', subject: 'Welcome aboard!', template: 'onboarding' },
    status: 'queued',
    priority: 5,
    attempts: 0,
    max_attempts: 5,
    run_at_offset_min: 0,
    locked_by: null,
    last_error: null,
    idempotency_key: 'seed-email-welcome-alice',
    events: [{ from: null, to: 'queued', attempt: 0, message: null, offset_min: -1 }],
  },

  // 2. Queued with higher priority
  {
    type: 'report.generate',
    payload: { reportId: 'RPT-2024-Q3', format: 'pdf' },
    status: 'queued',
    priority: 10,
    attempts: 0,
    max_attempts: 3,
    run_at_offset_min: 0,
    locked_by: null,
    last_error: null,
    idempotency_key: 'seed-report-q3',
    events: [{ from: null, to: 'queued', attempt: 0, message: null, offset_min: -2 }],
  },

  // 3. Succeeded — completed normally
  {
    type: 'image.resize',
    payload: { url: 'https://cdn.example.com/photo.jpg', width: 800, height: 600 },
    status: 'succeeded',
    priority: 0,
    attempts: 1,
    max_attempts: 3,
    run_at_offset_min: -30,
    locked_by: 'worker-0',
    last_error: null,
    idempotency_key: 'seed-image-resize',
    events: [
      { from: null, to: 'queued', attempt: 0, message: null, offset_min: -30 },
      { from: 'queued', to: 'running', attempt: 1, message: null, offset_min: -29 },
      { from: 'running', to: 'succeeded', attempt: 1, message: null, offset_min: -28 },
    ],
  },

  // 4. Succeeded — older completed job
  {
    type: 'webhook.deliver',
    payload: { url: 'https://hooks.example.com/events', event: 'order.shipped' },
    status: 'succeeded',
    priority: 3,
    attempts: 1,
    max_attempts: 5,
    run_at_offset_min: -120,
    locked_by: 'worker-2',
    last_error: null,
    idempotency_key: 'seed-webhook-shipped',
    events: [
      { from: null, to: 'queued', attempt: 0, message: null, offset_min: -120 },
      { from: 'queued', to: 'running', attempt: 1, message: null, offset_min: -119 },
      { from: 'running', to: 'succeeded', attempt: 1, message: null, offset_min: -118 },
    ],
  },

  // 5. Dead — failed all attempts, now in DLQ
  {
    type: 'payment.charge',
    payload: { customerId: 'cus_abc123', amount: 4999, currency: 'usd' },
    status: 'dead',
    priority: 8,
    attempts: 3,
    max_attempts: 3,
    run_at_offset_min: -60,
    locked_by: 'worker-1',
    last_error: 'PaymentGatewayError: card declined (insufficient funds)',
    idempotency_key: 'seed-payment-declined',
    events: [
      { from: null, to: 'queued', attempt: 0, message: null, offset_min: -60 },
      { from: 'queued', to: 'running', attempt: 1, message: null, offset_min: -59 },
      {
        from: 'running',
        to: 'retrying',
        attempt: 1,
        message: 'PaymentGatewayError: card declined',
        offset_min: -58,
      },
      { from: 'retrying', to: 'running', attempt: 2, message: null, offset_min: -50 },
      {
        from: 'running',
        to: 'retrying',
        attempt: 2,
        message: 'PaymentGatewayError: card declined',
        offset_min: -49,
      },
      { from: 'retrying', to: 'running', attempt: 3, message: null, offset_min: -40 },
      {
        from: 'running',
        to: 'dead',
        attempt: 3,
        message: 'PaymentGatewayError: card declined (insufficient funds)',
        offset_min: -39,
      },
    ],
  },

  // 6. Dead — another DLQ entry, different error
  {
    type: 'export.csv',
    payload: { userId: 'u_789', table: 'transactions', dateRange: '2024-01-01/2024-06-30' },
    status: 'dead',
    priority: 2,
    attempts: 5,
    max_attempts: 5,
    run_at_offset_min: -180,
    locked_by: 'worker-3',
    last_error: 'ENOSPC: no space left on device',
    idempotency_key: 'seed-export-csv-nospc',
    events: [
      { from: null, to: 'queued', attempt: 0, message: null, offset_min: -180 },
      { from: 'queued', to: 'running', attempt: 1, message: null, offset_min: -179 },
      {
        from: 'running',
        to: 'retrying',
        attempt: 1,
        message: 'ENOSPC: no space left on device',
        offset_min: -178,
      },
      { from: 'retrying', to: 'running', attempt: 2, message: null, offset_min: -170 },
      {
        from: 'running',
        to: 'retrying',
        attempt: 2,
        message: 'ENOSPC: no space left on device',
        offset_min: -169,
      },
      { from: 'retrying', to: 'running', attempt: 3, message: null, offset_min: -155 },
      {
        from: 'running',
        to: 'dead',
        attempt: 5,
        message: 'ENOSPC: no space left on device',
        offset_min: -154,
      },
    ],
  },

  // 7. Cancelled
  {
    type: 'notification.push',
    payload: { userId: 'u_456', title: 'Flash sale!', body: 'Up to 70% off' },
    status: 'cancelled',
    priority: 1,
    attempts: 0,
    max_attempts: 3,
    run_at_offset_min: -45,
    locked_by: null,
    last_error: null,
    idempotency_key: 'seed-push-cancelled',
    events: [
      { from: null, to: 'queued', attempt: 0, message: null, offset_min: -45 },
      { from: 'queued', to: 'cancelled', attempt: 0, message: 'cancelled by user', offset_min: -44 },
    ],
  },

  // 8. Queued but delayed (future run_at)
  {
    type: 'cleanup.sessions',
    payload: { olderThanDays: 30 },
    status: 'queued',
    priority: 0,
    attempts: 0,
    max_attempts: 1,
    run_at_offset_min: 60, // scheduled 1 hour in the future
    locked_by: null,
    last_error: null,
    idempotency_key: 'seed-cleanup-delayed',
    events: [{ from: null, to: 'queued', attempt: 0, message: null, offset_min: 0 }],
  },
];

async function seed(databaseUrl: string = config.databaseUrl): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Check if we already have seeded data
    const { rows } = await client.query<{ count: string }>('SELECT count(*) AS count FROM jobs');
    const existing = parseInt(rows[0]?.count ?? '0', 10);
    if (existing > 0) {
      logger.info({ existing }, 'jobs table already has data, skipping seed');
      return;
    }

    await client.query('BEGIN');
    try {
      for (const job of SEED_JOBS) {
        const now = Date.now();
        const runAt = new Date(now + job.run_at_offset_min * 60_000).toISOString();
        const createdAt = new Date(
          now + (job.events[0]?.offset_min ?? job.run_at_offset_min) * 60_000,
        ).toISOString();

        const { rows: inserted } = await client.query<{ id: string }>(
          `INSERT INTO jobs (type, payload, status, priority, attempts, max_attempts,
                             run_at, locked_by, last_error, idempotency_key, created_at, updated_at)
           VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
           RETURNING id`,
          [
            job.type,
            JSON.stringify(job.payload),
            job.status,
            job.priority,
            job.attempts,
            job.max_attempts,
            runAt,
            job.locked_by,
            job.last_error,
            job.idempotency_key,
            createdAt,
          ],
        );
        const jobId = inserted[0]!.id;

        for (const evt of job.events) {
          const eventTime = new Date(now + evt.offset_min * 60_000).toISOString();
          await client.query(
            `INSERT INTO job_events (job_id, from_status, to_status, attempt, message, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [jobId, evt.from, evt.to, evt.attempt, evt.message, eventTime],
          );
        }

        logger.info({ jobId, type: job.type, status: job.status }, 'seeded job');
      }
      await client.query('COMMIT');
      logger.info({ count: SEED_JOBS.length }, 'seed complete');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

const isMainModule =
  process.argv[1]?.endsWith('seed.ts') === true ||
  process.argv[1]?.endsWith('seed.js') === true;

if (isMainModule) {
  try {
    await seed();
  } catch (err) {
    logger.error({ err }, 'seed failed');
    process.exitCode = 1;
  }
}

export { seed };
