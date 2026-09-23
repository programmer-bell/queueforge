import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { respond } from '../http/respond.js';
import { requireToken } from '../middleware/requireToken.js';
import { cancelJob } from '../jobs/cancelJob.js';
import { enqueueJob } from '../jobs/enqueue.js';
import { getJobDetail } from '../jobs/getJob.js';
import { listJobs } from '../jobs/listJobs.js';
import { jobDetailFragment, jobListFragment, jobRowFragment } from '../views/jobs.js';

const JOB_STATUSES = ['queued', 'running', 'succeeded', 'retrying', 'dead', 'cancelled'] as const;

const enqueueSchema = z.object({
  type: z.string().min(1).max(200),
  payload: z.unknown().default({}),
  priority: z.number().int().default(0),
  run_at: z.string().datetime({ offset: true }).optional(),
  max_attempts: z.number().int().min(1).max(100).default(config.jobMaxAttemptsDefault),
  idempotency_key: z.string().min(1).max(200).optional(),
});

export const listQuerySchema = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  type: z.string().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

function validationFailed(error: z.ZodError): { error: string; details: unknown } {
  return { error: 'validation_error', details: error.flatten() };
}

export const jobsRouter = Router();

// POST /api/jobs — enqueue (gated: state-changing).
jobsRouter.post('/', requireToken, (req, res, next) => {
  const parsed = enqueueSchema.safeParse(req.body);
  if (!parsed.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Invalid job: ${parsed.error.issues.map((i) => i.message).join('; ')}</div>`,
      json: validationFailed(parsed.error),
    });
    return;
  }
  enqueueJob(pool, {
    type: parsed.data.type,
    payload: parsed.data.payload,
    priority: parsed.data.priority,
    runAt: parsed.data.run_at ? new Date(parsed.data.run_at) : null,
    maxAttempts: parsed.data.max_attempts,
    ...(parsed.data.idempotency_key !== undefined
      ? { idempotencyKey: parsed.data.idempotency_key }
      : {}),
  })
    .then(({ job, deduplicated }) => {
      respond(req, res, {
        status: deduplicated ? 200 : 201,
        html: jobRowFragment(job),
        json: { job, deduplicated },
      });
    })
    .catch(next);
});

// GET /api/jobs — list with status/type filters + pagination (public).
jobsRouter.get('/', (req, res, next) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Invalid query.</div>`,
      json: validationFailed(parsed.error),
    });
    return;
  }
  listJobs(pool, {
    ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
    page: parsed.data.page,
    perPage: parsed.data.per_page,
  })
    .then((result) => {
      respond(req, res, {
        html: jobListFragment(result.jobs),
        json: result,
      });
    })
    .catch(next);
});

// GET /api/jobs/:id — detail + event timeline (public).
jobsRouter.get('/:id', (req, res, next) => {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Invalid job id.</div>`,
      json: validationFailed(parsed.error),
    });
    return;
  }
  getJobDetail(pool, parsed.data.id)
    .then((detail) => {
      if (detail === null) {
        respond(req, res, {
          status: 404,
          html: `<div class="alert alert-warning">Job not found.</div>`,
          json: { error: 'not_found' },
        });
        return;
      }
      respond(req, res, {
        html: jobDetailFragment(detail.job, detail.events),
        json: detail,
      });
    })
    .catch(next);
});

// POST /api/jobs/:id/cancel — cancel a queued job (gated: state-changing).
jobsRouter.post('/:id/cancel', requireToken, (req, res, next) => {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Invalid job id.</div>`,
      json: validationFailed(parsed.error),
    });
    return;
  }
  cancelJob(pool, parsed.data.id)
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
          html: `<div class="alert alert-warning">Only queued jobs can be cancelled (current: ${result.job.status}).</div>`,
          json: { error: 'conflict', status: result.job.status },
        });
      } else {
        respond(req, res, {
          html: jobRowFragment(result.job),
          json: { job: result.job },
        });
      }
    })
    .catch(next);
});
