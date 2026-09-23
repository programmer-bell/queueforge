import { Router, type Request, type Response } from 'express';
import { bus, type JobTransition } from '../events/bus.js';
import type { StatsTick } from '../jobs/stats.js';

export const KEEPALIVE_MS = 20000;

/** Serialize one SSE frame: `event: <name>\ndata: <json>\n\n`. */
export function formatEventFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const eventsRouter = Router();

// GET /events — live stream of `job.transition` + `stats.tick`.
// Long-lived: comment keepalive every ~20s so proxies (incl. Render's)
// don't silently kill the stream; buffering explicitly disabled.
eventsRouter.get('/', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // Render/proxy note: never let an intermediary buffer this stream.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  req.socket.setTimeout(0);

  const send = (frame: string): void => {
    res.write(frame);
  };
  const onTransition = (transition: JobTransition): void => {
    send(formatEventFrame('job.transition', transition));
  };
  const onTick = (tick: StatsTick): void => {
    send(formatEventFrame('stats.tick', tick));
  };
  bus.on('job.transition', onTransition);
  bus.on('stats.tick', onTick);

  const keepalive = setInterval(() => {
    send(':\n\n');
  }, KEEPALIVE_MS);
  keepalive.unref?.();

  // Opening comment so clients see bytes immediately (proves no buffering).
  send(':\n\n');

  const cleanup = (): void => {
    clearInterval(keepalive);
    bus.off('job.transition', onTransition);
    bus.off('stats.tick', onTick);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
});
