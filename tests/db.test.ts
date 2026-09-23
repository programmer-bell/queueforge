import { afterAll, describe, expect, it } from 'vitest';
import { closePool, createListener, pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Runs against a real Postgres (docker-compose locally, service container in
// CI) — the correctness this project demonstrates lives in the SQL, so
// mocking the DB would defeat the point.
describe('database layer', () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM jobs WHERE type LIKE 'test.%'`);
    await closePool();
  });

  it('migrations are idempotent: a second run applies nothing', async () => {
    await migrate();
    const second = await migrate();
    expect(second).toEqual([]);
  });

  it('phase 1 tables exist', async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename IN ('jobs', 'job_events', 'schedules', 'job_type_limits', 'migrations')`,
    );
    expect(rows.map((r) => r.tablename).sort()).toEqual([
      'job_events',
      'job_type_limits',
      'jobs',
      'migrations',
      'schedules',
    ]);
  });

  it('inserting an actionable job fires NOTIFY job_available with the job id', async () => {
    const listener = createListener();
    const client = await listener;
    try {
      const received = new Promise<string | undefined>((resolve) => {
        const timer = setTimeout(() => resolve(undefined), 8000);
        client.on('notification', (msg) => {
          clearTimeout(timer);
          resolve(msg.payload);
        });
      });
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO jobs (type, payload) VALUES ('test.notify', $1) RETURNING id`,
        [JSON.stringify({ n: 1 })],
      );
      const payload = await received;
      expect(payload).toBe(rows[0]?.id);
    } finally {
      await client.end();
    }
  });

  it('duplicate idempotency_key is rejected by the unique constraint', async () => {
    await pool.query(`INSERT INTO jobs (type, idempotency_key) VALUES ('test.idem', 'test-key-1')`);
    await expect(
      pool.query(`INSERT INTO jobs (type, idempotency_key) VALUES ('test.idem', 'test-key-1')`),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
