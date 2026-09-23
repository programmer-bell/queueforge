import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { closePool, pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Job types here use the `testjobs.*` prefix (no `test.` prefix) so rows stay
// disjoint from tests/db.test.ts, which cleans up `type LIKE 'test.%'`.
const TYPE = 'testjobs.email';

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await pool.query(`DELETE FROM jobs WHERE type LIKE 'testjobs.%'`);
  await closePool();
});

async function enqueue(payload: unknown = {}, extra: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/jobs')
    .send({ type: TYPE, payload, ...extra });
}

describe('POST /api/jobs', () => {
  it('enqueues a job with 201 and a creation event', async () => {
    const res = await enqueue({ to: 'a@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.deduplicated).toBe(false);
    expect(res.body.job.type).toBe(TYPE);
    expect(res.body.job.status).toBe('queued');

    const events = await pool.query('SELECT * FROM job_events WHERE job_id = $1 ORDER BY id ASC', [
      res.body.job.id,
    ]);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({ from_status: null, to_status: 'queued' });
  });

  it('returns the existing job on a repeated idempotency_key instead of duplicating', async () => {
    const first = await enqueue({}, { idempotency_key: 'testjobs-key-1' });
    const second = await enqueue({ different: true }, { idempotency_key: 'testjobs-key-1' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.deduplicated).toBe(true);
    expect(second.body.job.id).toBe(first.body.job.id);

    const { rows } = await pool.query('SELECT COUNT(*) AS n FROM jobs WHERE idempotency_key = $1', [
      'testjobs-key-1',
    ]);
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('rejects invalid input with 400 validation_error', async () => {
    const missingType = await request(app).post('/api/jobs').send({ payload: {} });
    expect(missingType.status).toBe(400);
    expect(missingType.body.error).toBe('validation_error');

    const badRunAt = await enqueue({}, { run_at: 'not-a-date' });
    expect(badRunAt.status).toBe(400);

    const badAttempts = await enqueue({}, { max_attempts: 0 });
    expect(badAttempts.status).toBe(400);
  });

  it('applies priority, run_at and max_attempts overrides', async () => {
    const res = await enqueue(
      {},
      { priority: 9, run_at: '2030-01-01T00:00:00.000Z', max_attempts: 2 },
    );
    expect(res.status).toBe(201);
    expect(res.body.job).toMatchObject({ priority: 9, max_attempts: 2 });
    expect(new Date(res.body.job.run_at).getFullYear()).toBe(2030);
  });
});

describe('GET /api/jobs', () => {
  it('filters by type and paginates with a total', async () => {
    await enqueue();
    const res = await request(app).get('/api/jobs').query({ type: TYPE, per_page: 1 });
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.perPage).toBe(1);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.jobs).toHaveLength(1);
  });

  it('returns an HTML fragment for htmx requests', async () => {
    const res = await request(app).get('/api/jobs').set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('<table');
  });
});

describe('GET /api/jobs/:id', () => {
  it('returns the job with its event timeline', async () => {
    const created = await enqueue();
    const res = await request(app).get(`/api/jobs/${created.body.job.id}`);
    expect(res.status).toBe(200);
    expect(res.body.job.id).toBe(created.body.job.id);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].to_status).toBe('queued');
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const missing = await request(app).get('/api/jobs/00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('not_found');

    const malformed = await request(app).get('/api/jobs/not-a-uuid');
    expect(malformed.status).toBe(400);
  });
});

describe('POST /api/jobs/:id/cancel', () => {
  it('cancels a queued job and records the transition', async () => {
    const created = await enqueue();
    const res = await request(app).post(`/api/jobs/${created.body.job.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe('cancelled');

    const events = await pool.query(
      'SELECT * FROM job_events WHERE job_id = $1 ORDER BY id DESC LIMIT 1',
      [created.body.job.id],
    );
    expect(events.rows[0]).toMatchObject({ from_status: 'queued', to_status: 'cancelled' });
  });

  it('returns 409 when the job is no longer queued, 404 when unknown', async () => {
    const created = await enqueue();
    await pool.query(`UPDATE jobs SET status = 'running' WHERE id = $1`, [created.body.job.id]);
    const conflict = await request(app).post(`/api/jobs/${created.body.job.id}/cancel`);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('conflict');

    const missing = await request(app).post(
      '/api/jobs/00000000-0000-4000-8000-000000000000/cancel',
    );
    expect(missing.status).toBe(404);
  });
});

describe('DASHBOARD_TOKEN gating', () => {
  let gated: ReturnType<typeof request>;
  let closeGatedPool: () => Promise<void>;

  beforeAll(async () => {
    process.env['DASHBOARD_TOKEN'] = 'test-token';
    vi.resetModules();
    const serverMod = await import('../src/server.js');
    const poolMod = await import('../src/db/pool.js');
    gated = request(serverMod.app);
    closeGatedPool = poolMod.closePool;
  });

  afterAll(async () => {
    await closeGatedPool();
    delete process.env['DASHBOARD_TOKEN'];
    vi.resetModules();
  });

  it('rejects unauthenticated mutations with 401 but leaves reads public', async () => {
    const denied = await gated.post('/api/jobs').send({ type: TYPE });
    expect(denied.status).toBe(401);
    expect(denied.body.error).toBe('unauthorized');

    const deniedHtml = await gated.post('/api/jobs').set('HX-Request', 'true').send({ type: TYPE });
    expect(deniedHtml.status).toBe(401);
    expect(deniedHtml.text).toContain('Unauthorized');

    const readsOpen = await gated.get('/api/jobs');
    expect(readsOpen.status).toBe(200);
  });

  it('accepts mutations with a Bearer token', async () => {
    const res = await gated
      .post('/api/jobs')
      .set('Authorization', 'Bearer test-token')
      .send({ type: TYPE });
    expect(res.status).toBe(201);

    const cancel = await gated
      .post(`/api/jobs/${res.body.job.id}/cancel`)
      .set('Authorization', 'Bearer test-token');
    expect(cancel.status).toBe(200);
  });
});
