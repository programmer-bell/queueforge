import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import type { Client } from 'pg';
import { config } from '../config.js';
import { createListener } from '../db/pool.js';
import { emitTransition } from '../events/bus.js';
import { logger } from '../logger.js';
import type { MainToWorkerMessage, WorkerToMainMessage } from './protocol.js';

export interface StartPoolOptions {
  workerCount?: number;
  pollIntervalMs?: number;
  /** Override the worker entry file (tests point at the compiled `dist` copy). */
  workerPath?: string;
}

export interface ShutdownResult {
  drained: boolean;
  inFlight: number;
}

const log = logger.child({ component: 'poolManager' });

let workers: Worker[] = [];
let inFlight = new Set<string>();
let exited = new Set<Worker>();
let terminatedByUs = new Set<Worker>();
let shuttingDown = false;
let listenClient: Client | null = null;
let pollTimer: NodeJS.Timeout | null = null;

export function getWorkerPoolState(): {
  started: boolean;
  workerCount: number;
  inFlight: number;
} {
  return { started: workers.length > 0, workerCount: workers.length, inFlight: inFlight.size };
}

/** Sibling swap: poolManager.ts → worker.ts under tsx, poolManager.js → worker.js compiled. */
export function defaultWorkerPath(): string {
  const here = fileURLToPath(import.meta.url);
  const ext = here.endsWith('.ts') ? 'worker.ts' : 'worker.js';
  return join(dirname(here), ext);
}

function wakeAll(): void {
  if (shuttingDown) return;
  const msg: MainToWorkerMessage = { kind: 'wake' };
  for (const w of workers) w.postMessage(msg);
}

/**
 * Start the worker pool: N `worker_threads`, one LISTEN client on
 * `job_available` for instant wake-ups, plus a slow poll as the correctness
 * fallback. Idempotent start is rejected — call `shutdownWorkerPool` first.
 */
export async function startWorkerPool(options: StartPoolOptions = {}): Promise<void> {
  if (workers.length > 0) throw new Error('worker pool already started');
  shuttingDown = false;
  inFlight = new Set<string>();
  exited = new Set<Worker>();
  terminatedByUs = new Set<Worker>();

  const workerCount = options.workerCount ?? config.workerConcurrency;
  const pollIntervalMs = options.pollIntervalMs ?? config.pollIntervalMs;
  const workerPath = options.workerPath ?? defaultWorkerPath();

  for (let i = 0; i < workerCount; i += 1) {
    const workerId = `worker-${i}`;
    const worker = new Worker(workerPath, { workerData: { workerId } });
    worker.on('message', (msg: WorkerToMainMessage) => {
      if (msg.kind === 'transition') emitTransition(msg.transition);
      else if (msg.kind === 'claimed') inFlight.add(msg.jobId);
      else if (msg.kind === 'settled') inFlight.delete(msg.jobId);
    });
    worker.on('error', (err) => {
      log.error({ err, workerId }, 'worker thread error');
    });
    worker.on('exit', (code) => {
      exited.add(worker);
      if (code !== 0 && !terminatedByUs.has(worker)) {
        log.error({ workerId, code }, 'worker thread exited abnormally');
      }
    });
    workers.push(worker);
  }

  listenClient = await createListener();
  listenClient.on('notification', () => {
    wakeAll();
  });
  pollTimer = setInterval(() => {
    wakeAll();
  }, pollIntervalMs);
  pollTimer.unref?.();
  log.info({ workerCount, pollIntervalMs }, 'worker pool started');
  wakeAll();
}

/**
 * Graceful shutdown: stop claiming immediately, wait (up to
 * `drainTimeoutMs`) for in-flight jobs to settle, then terminate stragglers.
 */
export async function shutdownWorkerPool(
  drainTimeoutMs: number = config.shutdownDrainTimeoutMs,
): Promise<ShutdownResult> {
  shuttingDown = true;
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (listenClient !== null) {
    const client = listenClient;
    listenClient = null;
    await client.end().catch((err: unknown) => {
      log.warn({ err }, 'error closing LISTEN client');
    });
  }
  const shutdownMsg: MainToWorkerMessage = { kind: 'shutdown' };
  for (const w of workers) {
    try {
      if (!exited.has(w)) w.postMessage(shutdownMsg);
    } catch (err) {
      log.warn({ err }, 'failed to signal worker, will terminate it');
    }
  }

  const deadline = Date.now() + drainTimeoutMs;
  while (inFlight.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const drained = inFlight.size === 0;
  if (!drained) {
    log.warn({ inFlight: inFlight.size }, 'drain timeout exceeded, terminating workers');
  }
  // Workers exit themselves after finishing; only terminate stragglers so a
  // clean drain isn't mistaken for a crash (terminate() reports exit code 1).
  await Promise.all(
    workers.map(async (w) => {
      if (exited.has(w)) return;
      if (!drained) {
        terminatedByUs.add(w);
        await w.terminate();
        return;
      }
      const selfExited = await Promise.race([
        once(w, 'exit').then(() => true as const),
        new Promise((resolve) => setTimeout(() => resolve(false as const), 5000)),
      ]);
      if (selfExited !== true && !exited.has(w)) {
        terminatedByUs.add(w);
        await w.terminate();
      }
    }),
  );
  workers = [];
  inFlight = new Set<string>();
  log.info({ drained }, 'worker pool stopped');
  return { drained, inFlight: 0 };
}
