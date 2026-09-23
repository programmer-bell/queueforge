import { EventEmitter } from 'node:events';

export interface JobTransition {
  id: string;
  from: string | null;
  to: string;
  type: string;
}

/**
 * In-process event bus. Both the worker pool and API routes publish job
 * state transitions here; the SSE route (`GET /events`, Phase 5) subscribes
 * and forwards them to dashboard clients.
 */
export const bus = new EventEmitter();

// Every SSE connection adds two listeners by design — raise the ceiling so
// a popular demo dashboard doesn't trip the leak warning.
bus.setMaxListeners(100);

export function emitTransition(transition: JobTransition): void {
  bus.emit('job.transition', transition);
}
