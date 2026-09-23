import { Router } from 'express';
import { pool } from '../db/pool.js';
import { respond } from '../http/respond.js';
import { getStats, toStatsTick } from '../jobs/stats.js';
import { statCardsFragment } from '../views/dashboard.js';

/** Public stats snapshot — backs the initial page load; SSE only patches deltas. */

export const statsRouter = Router();

statsRouter.get('/', (_req, res, next) => {
  getStats(pool)
    .then((stats) => {
      const tick = toStatsTick(stats);
      respond(_req, res, {
        html: statCardsFragment(stats),
        json: tick,
      });
    })
    .catch(next);
});
