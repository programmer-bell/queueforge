import { pool } from '../db/pool.js';
import { logger } from '../logger.js';
import { getStats, toStatsTick } from '../jobs/stats.js';
import { bus } from './bus.js';

const log = logger.child({ component: 'statsTicker' });

let timer: NodeJS.Timeout | null = null;

/**
 * Publish `stats.tick` on the bus every `intervalMs`. One global ticker for
 * the process — SSE connections subscribe to the bus, they never query the
 * DB themselves. Started at server boot; tests drive it with a short
 * interval via the same entrypoint.
 */
export function startStatsTicker(intervalMs = 5000): void {
  if (timer !== null) return;
  const tick = async (): Promise<void> => {
    try {
      bus.emit('stats.tick', toStatsTick(await getStats(pool)));
    } catch (err) {
      log.warn({ err }, 'stats tick failed, will retry on next interval');
    }
  };
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
  void tick();
}

export function stopStatsTicker(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}
