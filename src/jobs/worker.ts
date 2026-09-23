import { parentPort, workerData } from 'node:worker_threads';
import { Client } from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { claimJob } from './claim.js';
import { completeJob } from './complete.js';
import { failJob } from './fail.js';
import { getHandler } from './handlers.js';
import type { Job } from './types.js';
import type { JobTransition } from '../events/bus.js';
import type { MainToWorkerMessage } from './protocol.js';

if (parentPort === null) {
  throw new Error('worker.ts must run inside a worker thread');
}
const port = parentPort;
const workerId: string = (workerData as { workerId?: unknown }).workerId as string;

/**
 * Worker thread entry. Owns one dedicated pg connection and loops:
 * wake → claim → execute → settle → claim again until the queue is dry.
 * The main thread owns LISTEN + the poll timer and just sends `wake`.
 */
const log = logger.child({ workerId });
const db = new Client({ connectionString: config.databaseUrl });

let shuttingDown = false;
let draining = false;

function notify(transition: JobTransition): void {
  port.postMessage({ kind: 'transition', transition });
}

async function executeAndSettle(jobId: string): Promise<void> {
  const { rows } = await db.query<{ type: string; payload: unknown }>(
    'SELECT type, payload FROM jobs WHERE id = $1',
    [jobId],
  );
  const row = rows[0];
  if (row === undefined) {
    log.error({ jobId }, 'claimed job vanished before execution');
    return;
  }
  const handler = getHandler(row.type);
  try {
    if (handler === undefined) {
      log.info({ jobId, type: row.type }, 'no handler registered, succeeding');
    } else {
      await handler(row.payload);
    }
    await completeJob(db, jobId, notify);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ jobId, err: message }, 'job failed, settling with backoff/DLQ');
    const { rows: claimed } = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    const current = claimed[0] as Job | undefined;
    if (current === undefined) {
      log.error({ jobId }, 'failed job vanished before settle');
      return;
    }
    await failJob(db, current, message, {}, notify);
  }
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (!shuttingDown) {
      const job = await claimJob(db, workerId, notify);
      if (job === null) {
        port.postMessage({ kind: 'idle' });
        break;
      }
      port.postMessage({ kind: 'claimed', jobId: job.id });
      try {
        await executeAndSettle(job.id);
      } finally {
        port.postMessage({ kind: 'settled', jobId: job.id });
      }
    }
  } catch (err) {
    log.error({ err }, 'drain loop error, waiting for next wake');
  } finally {
    draining = false;
    if (shuttingDown) await shutdownSelf();
  }
}

async function shutdownSelf(): Promise<void> {
  log.info('shutting down worker thread');
  try {
    await db.end();
  } finally {
    process.exit(0);
  }
}

port.on('message', (msg: MainToWorkerMessage) => {
  if (msg.kind === 'shutdown') {
    shuttingDown = true;
    if (!draining) void shutdownSelf();
    return;
  }
  if (msg.kind === 'wake' && !shuttingDown) {
    void drain();
  }
});

process.on('uncaughtException', (err) => {
  log.error({ err }, 'uncaught exception in worker thread');
  process.exit(1);
});

await db.connect();
log.info('worker thread online');
