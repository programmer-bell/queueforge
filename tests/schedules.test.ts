import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { closePool, pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { tickOnce } from '../src/jobs/scheduler.js';
import { isValidCron, nextRunAfter } from '../src/jobs/schedules.js';

// `testsched.*` stays disjoint from other test files' cleanup patterns.
const TYPE = 'testsched.heartbeat';

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await pool.query(`DELETE FROM jobs WHERE type LIKE 'testsched.%'`);
  await pool.query(`DELETE FROM schedules WHERE job_type LIKE 'testsched.%'`);
  await closePool();
});

async function createSchedule(
  agent: ReturnType<typeof request>,
  extra: Record<string, unknown> = {},
) {
  return agent.post('/api/schedules').send({
    name: 'heartbeat',
    cron: '* * * * *',
    job_type: TYPE,
    payload_template: { beat: 1 },
    ...extra,
  });
}

describe('cron helpers', () => {
  it('validates expressions and computes next runs', () => {
    expect(isValidCron('* * * * *')).toBe(true);
    expect(isValidCron('0 9 * * 1')).toBe(true);
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('')).toBe(false);

    const next = nextRunAfter('* * * * *', new Date('2026-01-01T00:00:30.000Z'));
    expect(next?.toISOString()).toBe('2026-01-01T00:01:00.000Z');
    expect(nextRunAfter('bogus', new Date())).toBeNull();
  });
});

describe('POST /api/schedules', () => {
  it('creates a schedule with 201', async () => {
    const res = await createSchedule(request(app));
    expect(res.status).toBe(201);
    expect(res.body.schedule).toMatchObject({
      name: 'heartbeat',
      cron: '* * * * *',
      job_type: TYPE,
      enabled: true,
    });
    expect(res.body.schedule.payload_template).toEqual({ beat: 1 });
  });

  it('rejects bad cron and missing fields with 400', async () => {
    const badCron = await createSchedule(request(app), { cron: 'every minute-ish' });
    expect(badCron.status).toBe(400);
    expect(badCron.body.error).toBe('validation_error');

    const missing = await request(app).post('/api/schedules').send({ cron: '* * * * *' });
    expect(missing.status).toBe(400);
  });
});

describe('GET /api/schedules', () => {
  it('lists schedules with a total', async () => {
    await createSchedule(request(app), { name: 'listed' });
    const res = await request(app).get('/api/schedules');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.schedules.length).toBeGreaterThanOrEqual(1);
  });

  it('returns a fragment for htmx requests', async () => {
    const res = await request(app).get('/api/schedules').set('HX-Request', 'true');
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/schedules/:id', () => {
  it('disables and re-enables a schedule', async () => {
    const created = await createSchedule(request(app), { name: 'toggleable' });
    const id = created.body.schedule.id as string;

    const off = await request(app).patch(`/api/schedules/${id}`).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.schedule.enabled).toBe(false);

    const on = await request(app).patch(`/api/schedules/${id}`).send({ enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.schedule.enabled).toBe(true);

    await pool.query('DELETE FROM schedules WHERE id = $1', [id]);
  });

  it('returns 404 for unknown ids and 400 for bad input', async () => {
    const missing = await request(app)
      .patch('/api/schedules/00000000-0000-4000-8000-000000000000')
      .send({ enabled: false });
    expect(missing.status).toBe(404);

    const created = await createSchedule(request(app), { name: 'bad-input' });
    const id = created.body.schedule.id as string;
    const badBody = await request(app).patch(`/api/schedules/${id}`).send({});
    expect(badBody.status).toBe(400);
    const badId = await request(app).patch('/api/schedules/nope').send({ enabled: true });
    expect(badId.status).toBe(400);
    await pool.query('DELETE FROM schedules WHERE id = $1', [id]);
  });

  it('requires the dashboard token when one is configured', async () => {
    process.env['DASHBOARD_TOKEN'] = 'test-token';
    vi.resetModules();
    const serverMod = await import('../src/server.js');
    const poolMod = await import('../src/db/pool.js');
    try {
      const gated = request(serverMod.app);
      const denied = await gated.post('/api/schedules').send({
        name: 'x',
        cron: '* * * * *',
        job_type: TYPE,
      });
      expect(denied.status).toBe(401);

      const allowed = await gated
        .post('/api/schedules')
        .set('Authorization', 'Bearer test-token')
        .send({ name: 'gated-ok', cron: '* * * * *', job_type: TYPE });
      expect(allowed.status).toBe(201);
      await poolMod.pool.query('DELETE FROM schedules WHERE id = $1', [allowed.body.schedule.id]);
    } finally {
      await poolMod.closePool();
      delete process.env['DASHBOARD_TOKEN'];
      vi.resetModules();
    }
  });
});

describe('scheduler tick', () => {
  it('enqueues a job for a due schedule and advances last_run_at', async () => {
    const created = await createSchedule(request(app), { name: 'ticker' });
    const id = created.body.schedule.id as string;
    // Force due: pretend it last fired an hour ago.
    await pool.query(
      `UPDATE schedules SET last_run_at = now() - make_interval(secs => 3600) WHERE id = $1`,
      [id],
    );

    const jobIds = await tickOnce(new Date());
    expect(jobIds).toHaveLength(1);

    const { rows } = await pool.query<{ type: string; payload: unknown }>(
      'SELECT type, payload FROM jobs WHERE id = $1',
      [jobIds[0]],
    );
    expect(rows[0]?.type).toBe(TYPE);
    expect(rows[0]?.payload).toEqual({ beat: 1 });

    // Immediate re-tick must not double-fire.
    expect(await tickOnce(new Date())).toHaveLength(0);

    await pool.query('DELETE FROM jobs WHERE id = $1', [jobIds[0]]);
    await pool.query('DELETE FROM schedules WHERE id = $1', [id]);
  });

  it('skips disabled and not-yet-due schedules', async () => {
    const created = await createSchedule(request(app), { name: 'skipped' });
    const id = created.body.schedule.id as string;
    await pool.query('UPDATE schedules SET enabled = false WHERE id = $1', [id]);
    await pool.query(
      `UPDATE schedules SET last_run_at = now() - make_interval(secs => 3600) WHERE id = $1`,
      [id],
    );
    expect(await tickOnce(new Date())).toHaveLength(0);

    // Enabled but fired just now → next occurrence is in the future.
    await pool.query('UPDATE schedules SET enabled = true, last_run_at = now() WHERE id = $1', [
      id,
    ]);
    expect(await tickOnce(new Date())).toHaveLength(0);
    await pool.query('DELETE FROM schedules WHERE id = $1', [id]);
  });
});

describe('GET /schedules', () => {
  it('renders the management page with form and table', async () => {
    await createSchedule(request(app), { name: 'paged' });
    const res = await request(app).get('/schedules');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
    expect(res.text).toContain('Recurring jobs');
    expect(res.text).toContain('id="schedule-form"');
    expect(res.text).toContain('Schedules');
  });

  it('returns just the fragment for htmx requests', async () => {
    const res = await request(app).get('/schedules').set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<!DOCTYPE html>');
    expect(res.text).toContain('Recurring jobs');
  });
});
