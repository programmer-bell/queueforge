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

export function emitTransition(transition: JobTransition): void {
  bus.emit('job.transition', transition);
}
