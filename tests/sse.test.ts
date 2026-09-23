import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { closePool, pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { enqueueJob } from '../src/jobs/enqueue.js';
import { bus } from '../src/events/bus.js';
import { startStatsTicker, stopStatsTicker } from '../src/events/statsTicker.js';
import { formatEventFrame } from '../src/routes/events.js';

const TYPE = 'testsse.ping';

interface SseFrame {
  event: string;
  data: string;
}

function parseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    if (part === '' || part.startsWith(':')) continue;
    const event = part.match(/^event: (.*)$/m)?.[1] ?? 'message';
    const data = part.match(/^data: (.*)$/m)?.[1] ?? '';
    frames.push({ event, data });
  }
  return { frames, rest };
}

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await pool.query(`DELETE FROM jobs WHERE type LIKE 'testsse.%'`);
  await closePool();
});

describe('formatEventFrame', () => {
  it('serializes event + JSON data frames', () => {
    expect(formatEventFrame('job.transition', { id: 'x' })).toBe(
      'event: job.transition\ndata: {"id":"x"}\n\n',
    );
  });
});

describe('GET /api/stats', () => {
  it('returns the tick-shaped JSON snapshot', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
    for (const key of ['queued', 'running', 'succeeded', 'failed', 'dead', 'throughputPerMin']) {
      expect(res.body).toHaveProperty(key);
      expect(typeof res.body[key]).toBe('number');
    }
  });

  it('returns the stat-cards fragment for htmx requests', async () => {
    const res = await request(app).get('/api/stats').set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="stats-cards"');
  });
});

describe('GET /events', () => {
  it('streams stats.tick frames and live job.transition events', async () => {
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    startStatsTicker(150);

    const seen: SseFrame[] = [];
    let buffer = '';
    const req = http.get(
      { port, path: '/events', headers: { Accept: 'text/event-stream' } },
      (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/event-stream/);
        expect(res.headers['x-accel-buffering']).toBe('no');
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const parsed = parseFrames(buffer);
          buffer = parsed.rest;
          seen.push(...parsed.frames);
        });
      },
    );

    try {
      // A stats.tick arrives from the immediate + interval ticks…
      await waitFor(() => seen.some((f) => f.event === 'stats.tick'), 5000, 'tick');
      const tick = JSON.parse(seen.find((f) => f.event === 'stats.tick')?.data ?? '{}') as Record<
        string,
        unknown
      >;
      for (const key of ['queued', 'running', 'succeeded', 'failed', 'dead']) {
        expect(tick).toHaveProperty(key);
      }

      // …and a live transition flows through the bus to the socket.
      const { job } = await enqueueJob(pool, {
        type: TYPE,
        payload: {},
        priority: 0,
        runAt: null,
        maxAttempts: 3,
      });
      await waitFor(
        () =>
          seen.some((f) => {
            try {
              return (
                f.event === 'job.transition' &&
                (JSON.parse(f.data) as { id?: string }).id === job.id
              );
            } catch {
              return false;
            }
          }),
        5000,
        'transition',
      );
      await pool.query('DELETE FROM jobs WHERE id = $1', [job.id]);
    } finally {
      req.destroy();
      stopStatsTicker();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20000);
});

describe('dashboard live wiring', () => {
  it('embeds the EventSource script with card ids and status dot', async () => {
    const res = await request(app).get('/');
    expect(res.text).toContain("new EventSource('/events')");
    expect(res.text).toContain('id="live-dot"');
    for (const id of [
      'stat-queued',
      'stat-running',
      'stat-succeeded',
      'stat-retrying',
      'stat-dead',
      'stat-throughput',
    ]) {
      expect(res.text).toContain(`id="${id}"`);
    }
  });

  it('unsubscribes cleanly: no bus listeners leak per connection', async () => {
    const before = bus.listenerCount('job.transition');
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) => {
      const r = http.get({ port, path: '/events' }, (res) => {
        res.on('data', () => {
          r.destroy();
        });
        res.on('close', () => resolve());
      });
      r.on('error', reject);
      setTimeout(() => reject(new Error('no SSE bytes in time')), 5000);
    });
    await new Promise((r) => setTimeout(r, 200));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(bus.listenerCount('job.transition')).toBe(before);
  });
});

async function waitFor(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (condition()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
