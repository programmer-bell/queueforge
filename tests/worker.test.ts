import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { closePool, pool } from '../src/db/pool.js';
import { enqueueJob } from '../src/jobs/enqueue.js';
import { getHandler, registerHandler } from '../src/jobs/handlers.js';
import {
  getWorkerPoolState,
  shutdownWorkerPool,
  startWorkerPool,
} from '../src/jobs/poolManager.js';

// Vitest (plain node) cannot execute the `.ts` worker entry, so integration
// tests point the pool at the compiled copy — `pretest` guarantees `dist`
// is freshly built before every `npm test`, and CI builds before testing.
const workerPath = join(process.cwd(), 'dist', 'jobs', 'worker.js');

const createdIds: string[] = [];

beforeAll(async () => {
  if (!existsSync(workerPath)) {
    throw new Error(`worker entry missing at ${workerPath} — run npm run build first`);
  }
  await migrate();
});

afterEach(async () => {
  await shutdownWorkerPool(1000).catch(() => {});
  if (createdIds.length > 0) {
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [createdIds.splice(0)]);
  }
});

afterAll(async () => {
  await closePool();
});

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function jobStatus(id: string): Promise<string | null> {
  const { rows } = await pool.query<{ status: string }>('SELECT status FROM jobs WHERE id = $1', [
    id,
  ]);
  return rows[0]?.status ?? null;
}

describe('handlers registry', () => {
  it('registers and resolves handlers; unknown types resolve to undefined', () => {
    registerHandler('testjobs.w.custom', () => {});
    expect(getHandler('testjobs.w.custom')).toBeTypeOf('function');
    expect(getHandler('testjobs.w.nope')).toBeUndefined();
  });
});

describe('worker pool integration', () => {
  it('executes jobs to succeeded and dead through real worker threads', async () => {
    await startWorkerPool({ workerCount: 2, pollIntervalMs: 100, workerPath });
    expect(getWorkerPoolState()).toMatchObject({ started: true, workerCount: 2 });

    const okIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { job } = await enqueueJob(pool, {
        type: 'demo.echo',
        payload: { i },
        priority: 0,
        runAt: null,
        maxAttempts: 3,
      });
      okIds.push(job.id);
      createdIds.push(job.id);
    }
    const { job: doomed } = await enqueueJob(pool, {
      type: 'demo.fail',
      payload: {},
      priority: 0,
      runAt: null,
      maxAttempts: 1,
    });
    createdIds.push(doomed.id);

    await waitFor(
      async () => {
        const { rows } = await pool.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM jobs
         WHERE id = ANY($1::uuid[]) AND status IN ('succeeded', 'dead')`,
          [[...okIds, doomed.id]],
        );
        return Number(rows[0]?.n) === 4;
      },
      15000,
      'all four jobs to settle',
    );

    for (const id of okIds) expect(await jobStatus(id)).toBe('succeeded');
    expect(await jobStatus(doomed.id)).toBe('dead');

    const result = await shutdownWorkerPool();
    expect(result.drained).toBe(true);
  }, 30000);

  it('graceful shutdown lets an in-flight job finish instead of dropping it', async () => {
    await startWorkerPool({ workerCount: 1, pollIntervalMs: 50, workerPath });
    const { job } = await enqueueJob(pool, {
      type: 'demo.slow',
      payload: { ms: 2000 },
      priority: 0,
      runAt: null,
      maxAttempts: 3,
    });
    createdIds.push(job.id);

    await waitFor(async () => (await jobStatus(job.id)) === 'running', 10000, 'job to start');
    const result = await shutdownWorkerPool();
    expect(result.drained).toBe(true);
    expect(await jobStatus(job.id)).toBe('succeeded');
  }, 30000);

  it('drain timeout terminates stragglers instead of hanging forever', async () => {
    await startWorkerPool({ workerCount: 1, pollIntervalMs: 50, workerPath });
    const { job } = await enqueueJob(pool, {
      type: 'demo.slow',
      payload: { ms: 30000 },
      priority: 0,
      runAt: null,
      maxAttempts: 3,
    });
    createdIds.push(job.id);

    await waitFor(async () => (await jobStatus(job.id)) === 'running', 10000, 'job to start');
    const result = await shutdownWorkerPool(500);
    expect(result.drained).toBe(false);
    expect(getWorkerPoolState().started).toBe(false);
  }, 30000);
});
