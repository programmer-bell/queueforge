import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { respond } from '../http/respond.js';
import { requireToken } from '../middleware/requireToken.js';
import { listDeadJobs, replayJob } from '../jobs/dlq.js';
import { dlqTableFragment } from '../views/dlq.js';
import { idParamSchema } from './jobs.js';

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

export const dlqRouter = Router();

// GET /api/dlq — dead-letter listing, paginated (public).
dlqRouter.get('/', (req, res, next) => {
  const parsed = pageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Invalid query.</div>`,
      json: { error: 'validation_error', details: parsed.error.flatten() },
    });
    return;
  }
  listDeadJobs(pool, parsed.data.page, parsed.data.per_page)
    .then((result) => {
      respond(req, res, {
        html: dlqTableFragment(result.jobs),
        json: result,
      });
    })
    .catch(next);
});

// POST /api/dlq/:id/replay — dead → queued with attempts reset (gated).
dlqRouter.post('/:id/replay', requireToken, (req, res, next) => {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Invalid job id.</div>`,
      json: { error: 'validation_error', details: parsed.error.flatten() },
    });
    return;
  }
  replayJob(pool, parsed.data.id)
    .then((result) => {
      if (result.outcome === 'not-found') {
        respond(req, res, {
          status: 404,
          html: `<div class="alert alert-warning">Job not found.</div>`,
          json: { error: 'not_found' },
        });
      } else if (result.outcome === 'conflict') {
        respond(req, res, {
          status: 409,
          html: `<div class="alert alert-warning">Only dead jobs can be replayed (current: ${result.job.status}).</div>`,
          json: { error: 'conflict', status: result.job.status },
        });
      } else {
        // htmx swaps this empty body over `closest tr`, removing the row
        // from the DLQ table; SSE ticks update the stat cards.
        respond(req, res, {
          html: '',
          json: { job: result.job },
        });
      }
    })
    .catch(next);
});
