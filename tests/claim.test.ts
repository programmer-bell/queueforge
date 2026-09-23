import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeBackoffSeconds } from '../src/jobs/backoff.js';
import { claimJob } from '../src/jobs/claim.js';
import { completeJob } from '../src/jobs/complete.js';
import { enqueueJob } from '../src/jobs/enqueue.js';
import { failJob } from '../src/jobs/fail.js';
import { closePool, pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { bus } from '../src/events/bus.js';

// `testclaim.*` stays disjoint from other test files' cleanup patterns.
const TYPE = 'testclaim.job';

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await pool.query(`DELETE FROM jobs WHERE type LIKE 'testclaim.%'`);
  await pool.query(`DELETE FROM job_type_limits WHERE job_type LIKE 'testclaim.%'`);
  await closePool();
});

async function seedQueued(count: number, type: string = TYPE): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const { job } = await enqueueJob(pool, {
      type,
      payload: { i },
      priority: 0,
      runAt: null,
      maxAttempts: 3,
    });
    ids.push(job.id);
  }
  return ids;
}

describe('computeBackoffSeconds', () => {
  it('grows exponentially and caps at the max', () => {
    expect(computeBackoffSeconds(1, 10, 3600)).toBe(20);
    expect(computeBackoffSeconds(2, 10, 3600)).toBe(40);
    expect(computeBackoffSeconds(10, 10, 3600)).toBe(3600);
  });
});

describe('claimJob concurrency', () => {
  it('N parallel claims never double-assign and lose nothing', async () => {
    const ids = await seedQueued(5);
    const claimants = 8;
    const clients = await Promise.all(Array.from({ length: claimants }, () => pool.connect()));
    try {
      const transitions: unknown[] = [];
      const onTransition = (t: unknown) => {
        transitions.push(t);
      };
      bus.on('job.transition', onTransition);
      const results = await Promise.all(
        clients.map((client, i) =>
          claimJob(client, `testclaim-w-${i}`, (t) => {
            onTransition(t);
          }),
        ),
      );
      bus.off('job.transition', onTransition);

      const claimed = results.filter((r) => r !== null);
      // 5 jobs, 8 claimants → exactly 5 claims, 3 nulls, all distinct.
      expect(claimed).toHaveLength(5);
      expect(new Set(claimed.map((j) => j?.id)).size).toBe(5);
      expect(new Set(ids).size).toBe(5);
      for (const id of ids) {
        expect(claimed.some((j) => j?.id === id)).toBe(true);
      }
      const owners = claimed.map((j) => j?.locked_by);
      expect(new Set(owners).size).toBe(5);
      for (const job of claimed) {
        expect(job).toMatchObject({ status: 'running', attempts: 1 });
      }
      expect(transitions).toHaveLength(5);

      // Settle everything so later tests start from a clean slate.
      const settler = clients[0] as (typeof clients)[number];
      for (const job of claimed) {
        if (job !== null) await completeJob(settler, job.id, () => {});
      }
    } finally {
      for (const c of clients) c.release();
    }
  });

  it('returns null when nothing is actionable', async () => {
    const client = await pool.connect();
    try {
      // Future-dated retrying job is not actionable yet.
      const { job } = await enqueueJob(pool, {
        type: TYPE,
        payload: {},
        priority: 0,
        runAt: new Date(Date.now() + 60000),
        maxAttempts: 3,
      });
      expect(await claimJob(client, 'testclaim-w-idle', () => {})).toBeNull();
      await pool.query('DELETE FROM jobs WHERE id = $1', [job.id]);
    } finally {
      client.release();
    }
  });

  it('respects per-type concurrency limits', async () => {
    await seedQueued(2, 'testclaim.limited');
    await seedQueued(1, 'testclaim.free');
    // Occupy the single slot for the limited type.
    await pool.query(
      `UPDATE jobs SET status = 'running', locked_by = 'testclaim-holder'
       WHERE id = (SELECT id FROM jobs WHERE type = 'testclaim.limited' AND status = 'queued' LIMIT 1)`,
    );
    await pool.query(
      `INSERT INTO job_type_limits (job_type, max_concurrency)
       VALUES ('testclaim.limited', 1)
       ON CONFLICT (job_type) DO UPDATE SET max_concurrency = 1`,
    );
    const client = await pool.connect();
    try {
      // Must skip the saturated type and claim the free one.
      const first = await claimJob(client, 'testclaim-w-lim', () => {});
      expect(first?.type).toBe('testclaim.free');
      // Clean up all rows from this test so later tests see a clean slate.
      await pool.query(`DELETE FROM jobs WHERE type LIKE 'testclaim.%'`);
    } finally {
      client.release();
    }
  });
});

describe('settle transitions', () => {
  it('completeJob moves running → succeeded with an event', async () => {
    const [id] = await seedQueued(1);
    const client = await pool.connect();
    try {
      const claimed = await claimJob(client, 'testclaim-w-done', () => {});
      expect(claimed?.id).toBe(id);
      const done = await completeJob(client, id as string, () => {});
      expect(done.status).toBe('succeeded');
      const events = await pool.query(
        'SELECT from_status, to_status FROM job_events WHERE job_id = $1 ORDER BY id ASC',
        [id],
      );
      expect(events.rows.map((r) => r.to_status)).toEqual(['queued', 'succeeded']);
    } finally {
      client.release();
    }
  });

  it('failJob retries with future run_at, then goes dead at max_attempts', async () => {
    const [id] = await seedQueued(1);
    const client = await pool.connect();
    try {
      const claimed = await claimJob(client, 'testclaim-w-fail', () => {});
      expect(claimed).toMatchObject({ attempts: 1, max_attempts: 3 });
      const retrying = await failJob(
        client,
        claimed as NonNullable<typeof claimed>,
        'boom',
        { baseDelaySec: 10, maxDelaySec: 3600 },
        () => {},
      );
      expect(retrying.status).toBe('retrying');
      // attempts=1 → 10 * 2^1 = 20s backoff.
      const runAtMs = new Date(retrying.run_at).getTime() - Date.now();
      expect(runAtMs).toBeGreaterThan(15000);
      expect(runAtMs).toBeLessThanOrEqual(25000);

      // Exhaust attempts: claim twice more (forcing run_at due), third failure → dead.
      for (let n = 0; n < 2; n += 1) {
        await pool.query('UPDATE jobs SET run_at = now() WHERE id = $1', [id]);
        const c = await claimJob(client, 'testclaim-w-fail', () => {});
        expect(c).not.toBeNull();
        await failJob(client, c as NonNullable<typeof c>, 'boom again', {}, () => {});
      }
      const { rows } = await pool.query('SELECT status, attempts FROM jobs WHERE id = $1', [id]);
      expect(rows[0]).toMatchObject({ status: 'dead', attempts: 3 });
      const events = await pool.query(
        'SELECT to_status FROM job_events WHERE job_id = $1 ORDER BY id ASC',
        [id],
      );
      expect(events.rows.map((r) => r.to_status)).toEqual([
        'queued',
        'retrying',
        'retrying',
        'dead',
      ]);
    } finally {
      client.release();
    }
  });

  it('failJob goes straight to dead when max_attempts is 1', async () => {
    const { job } = await enqueueJob(pool, {
      type: TYPE,
      payload: {},
      priority: 0,
      runAt: null,
      maxAttempts: 1,
    });
    const client = await pool.connect();
    try {
      const claimed = await claimJob(client, 'testclaim-w-once', () => {});
      const dead = await failJob(
        client,
        claimed as NonNullable<typeof claimed>,
        'first and last',
        {},
        () => {},
      );
      expect(dead.status).toBe('dead');
      expect(job.id).toBe(dead.id);
    } finally {
      client.release();
    }
  });

  it('settle on a non-running job throws loudly', async () => {
    const [id] = await seedQueued(1);
    const client = await pool.connect();
    try {
      await expect(completeJob(client, id as string, () => {})).rejects.toThrow(/not running/);
    } finally {
      client.release();
    }
    await pool.query('DELETE FROM jobs WHERE id = $1', [id]);
  });
});

describe('bus wiring', () => {
  it('claim/complete/fail publish job.transition by default', async () => {
    const seen: string[] = [];
    const listener = (t: { id: string; to: string }) => {
      seen.push(t.to);
    };
    bus.on('job.transition', listener);
    const [id] = await seedQueued(1);
    const client = await pool.connect();
    try {
      const claimed = await claimJob(client, 'testclaim-w-bus');
      await completeJob(client, (claimed as NonNullable<typeof claimed>).id);
      expect(seen).toContain('running');
      expect(seen).toContain('succeeded');
      expect(id).toBeDefined();
    } finally {
      client.release();
      bus.off('job.transition', listener);
    }
  });
});
