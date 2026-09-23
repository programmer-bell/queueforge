import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { closePool, pool } from '../src/db/pool.js';
import { getStats } from '../src/jobs/stats.js';
import { migrate } from '../src/db/migrate.js';

// `testdash.*` stays disjoint from other test files' cleanup patterns.
const TYPE = 'testdash.widget';

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await pool.query(`DELETE FROM jobs WHERE type LIKE 'testdash.%'`);
  await closePool();
});

describe('getStats', () => {
  it('counts per-status depth and trailing-minute throughput', async () => {
    await pool.query(
      `INSERT INTO jobs (type, status) VALUES
       ('${TYPE}', 'queued'), ('${TYPE}', 'queued'),
       ('${TYPE}', 'running'), ('${TYPE}', 'succeeded'), ('${TYPE}', 'dead')`,
    );
    const before = await getStats(pool);
    await pool.query(
      `INSERT INTO job_events (job_id, to_status)
       SELECT id, 'queued' FROM jobs WHERE type = '${TYPE}' LIMIT 2`,
    );
    const stats = await getStats(pool);
    expect(stats.counts.queued).toBeGreaterThanOrEqual(2);
    expect(stats.counts.running).toBeGreaterThanOrEqual(1);
    expect(stats.counts.succeeded).toBeGreaterThanOrEqual(1);
    expect(stats.counts.dead).toBeGreaterThanOrEqual(1);
    expect(stats.throughputPerMin).toBeGreaterThanOrEqual(before.throughputPerMin + 2);
  });
});

describe('GET /', () => {
  it('renders the full dashboard page', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('<!DOCTYPE html>');
    expect(res.text).toContain('QueueForge');
    expect(res.text).toContain('id="stats-cards"');
    expect(res.text).toContain('id="enqueue-form"');
    expect(res.text).toContain('id="recent-jobs"');
    expect(res.text).toContain('htmx.org');
    expect(res.text).toContain('bootstrap');
  });

  it('returns just the fragment for htmx requests', async () => {
    const res = await request(app).get('/').set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="stats-cards"');
    expect(res.text).not.toContain('<!DOCTYPE html>');
  });

  it('hides the Manage control when DASHBOARD_TOKEN is unset', async () => {
    const res = await request(app).get('/');
    expect(res.text).not.toContain('>Manage<');
  });
});

describe('GET /jobs', () => {
  it('renders filter form, table and pagination', async () => {
    const res = await request(app).get('/jobs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
    expect(res.text).toContain('Filter');
    expect(res.text).toContain('Page 1 of');
  });

  it('filters by status and rejects bad query params', async () => {
    const ok = await request(app).get('/jobs').query({ status: 'queued' });
    expect(ok.status).toBe(200);
    const bad = await request(app).get('/jobs').query({ status: 'bogus' });
    expect(bad.status).toBe(400);
  });

  it('returns just the fragment for htmx requests', async () => {
    const res = await request(app).get('/jobs').set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<!DOCTYPE html>');
    expect(res.text).toContain('<form');
  });
});

describe('GET /jobs/:id', () => {
  it('renders detail with payload and timeline', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO jobs (type, payload) VALUES ('${TYPE}', '{"a":1}') RETURNING id`,
    );
    const id = rows[0]?.id as string;
    await pool.query(
      'INSERT INTO job_events (job_id, from_status, to_status) VALUES ($1, NULL, $2)',
      [id, 'queued'],
    );
    const res = await request(app).get(`/jobs/${id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Timeline');
    expect(res.text).toContain('&quot;a&quot;');
  });

  it('returns 404 pages and fragments for unknown ids', async () => {
    const page = await request(app).get('/jobs/00000000-0000-4000-8000-000000000000');
    expect(page.status).toBe(404);
    expect(page.text).toContain('Job not found');
    const frag = await request(app)
      .get('/jobs/00000000-0000-4000-8000-000000000000')
      .set('HX-Request', 'true');
    expect(frag.status).toBe(404);
    expect(frag.text).not.toContain('<!DOCTYPE html>');
  });
});
