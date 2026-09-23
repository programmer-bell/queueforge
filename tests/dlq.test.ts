import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { closePool, pool } from '../src/db/pool.js';
import { bus } from '../src/events/bus.js';
import { migrate } from '../src/db/migrate.js';

// `testdlq.*` stays disjoint from other test files' cleanup patterns.
const TYPE = 'testdlq.broken';

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await pool.query(`DELETE FROM jobs WHERE type LIKE 'testdlq.%'`);
  await closePool();
});

async function seedDead(lastError = 'boom'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO jobs (type, status, attempts, max_attempts, last_error)
     VALUES ($1, 'dead', 3, 3, $2) RETURNING id`,
    [TYPE, lastError],
  );
  const id = rows[0]?.id as string;
  await pool.query(
    `INSERT INTO job_events (job_id, from_status, to_status, attempt, message)
     VALUES ($1, 'running', 'dead', 3, $2)`,
    [id, lastError],
  );
  return id;
}

describe('GET /api/dlq', () => {
  it('lists dead jobs with pagination and ignores other statuses', async () => {
    const id = await seedDead();
    await pool.query(`INSERT INTO jobs (type, status) VALUES ('${TYPE}', 'queued')`);
    const res = await request(app).get('/api/dlq');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.jobs.every((j: { status: string }) => j.status === 'dead')).toBe(true);
    expect(res.body.jobs.some((j: { id: string }) => j.id === id)).toBe(true);
  });

  it('returns the table fragment for htmx requests', async () => {
    await seedDead();
    const res = await request(app).get('/api/dlq').set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Replay');
  });
});

describe('POST /api/dlq/:id/replay', () => {
  it('moves dead → queued with attempts reset, an event and a bus transition', async () => {
    const id = await seedDead();
    const transitions: Array<{ id: string; from: string | null; to: string }> = [];
    const listener = (t: { id: string; from: string | null; to: string }) => {
      if (t.id === id) transitions.push(t);
    };
    bus.on('job.transition', listener);
    try {
      const res = await request(app).post(`/api/dlq/${id}/replay`);
      expect(res.status).toBe(200);
      expect(res.body.job).toMatchObject({ id, status: 'queued', attempts: 0 });
      expect(new Date(res.body.job.run_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    } finally {
      bus.off('job.transition', listener);
    }
    expect(transitions).toEqual([{ id, from: 'dead', to: 'queued', type: TYPE }]);

    const events = await pool.query(
      'SELECT from_status, to_status, attempt FROM job_events WHERE job_id = $1 ORDER BY id DESC LIMIT 1',
      [id],
    );
    expect(events.rows[0]).toMatchObject({ from_status: 'dead', to_status: 'queued', attempt: 0 });
  });

  it('removes the row via htmx swap semantics (empty fragment, gone from list)', async () => {
    const id = await seedDead();
    const hx = await request(app).post(`/api/dlq/${id}/replay`).set('HX-Request', 'true');
    expect(hx.status).toBe(200);
    expect(hx.text).toBe('');
    const list = await request(app).get('/api/dlq');
    expect(list.body.jobs.some((j: { id: string }) => j.id === id)).toBe(false);
  });

  it('returns 409 for non-dead jobs and 404 for unknown ids', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO jobs (type, status) VALUES ('${TYPE}', 'queued') RETURNING id`,
    );
    const queuedId = rows[0]?.id as string;
    const conflict = await request(app).post(`/api/dlq/${queuedId}/replay`);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('conflict');

    const missing = await request(app).post('/api/dlq/00000000-0000-4000-8000-000000000000/replay');
    expect(missing.status).toBe(404);
  });

  it('requires the dashboard token when one is configured', async () => {
    process.env['DASHBOARD_TOKEN'] = 'test-token';
    vi.resetModules();
    const serverMod = await import('../src/server.js');
    const poolMod = await import('../src/db/pool.js');
    try {
      const gated = request(serverMod.app);
      const denied = await gated.post('/api/dlq/00000000-0000-4000-8000-000000000000/replay');
      expect(denied.status).toBe(401);

      const id = await seedDead();
      const allowed = await gated
        .post(`/api/dlq/${id}/replay`)
        .set('Authorization', 'Bearer test-token');
      expect(allowed.status).toBe(200);
    } finally {
      await poolMod.closePool();
      delete process.env['DASHBOARD_TOKEN'];
      vi.resetModules();
    }
  });
});

describe('GET /dlq', () => {
  it('renders the DLQ page with replay buttons', async () => {
    await seedDead('paged demarcation');
    const res = await request(app).get('/dlq');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
    expect(res.text).toContain('Dead-letter queue');
    expect(res.text).toContain('Replay');
  });

  it('returns just the fragment for htmx requests', async () => {
    const res = await request(app).get('/dlq').set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<!DOCTYPE html>');
    expect(res.text).toContain('Dead-letter queue');
  });
});
