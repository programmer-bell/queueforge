import type { JobTransition } from '../events/bus.js';

/** Main thread → worker. */
export type MainToWorkerMessage = { kind: 'wake' } | { kind: 'shutdown' };

/** Worker → main thread. Transitions are forwarded onto the bus there —
 * worker threads have isolated memory, so emitting on the bus directly
 * inside a worker would never reach SSE subscribers. */
export type WorkerToMainMessage =
  | { kind: 'idle' }
  | { kind: 'claimed'; jobId: string }
  | { kind: 'settled'; jobId: string }
  | { kind: 'transition'; transition: JobTransition };
