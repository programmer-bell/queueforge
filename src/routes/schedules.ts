import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { respond } from '../http/respond.js';
import { requireToken } from '../middleware/requireToken.js';
import {
  createSchedule,
  isValidCron,
  listSchedules,
  setScheduleEnabled,
} from '../jobs/schedules.js';
import { escapeHtml } from '../views/html.js';

export const schedulePageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

const scheduleCreateSchema = z.object({
  name: z.string().min(1).max(200),
  cron: z
    .string()
    .min(1)
    .max(100)
    .refine(isValidCron, { message: 'Invalid cron expression (expected 5-field standard cron)' }),
  job_type: z.string().min(1).max(200),
  payload_template: z.unknown().default({}),
  priority: z.number().int().default(0),
  max_attempts: z.number().int().min(1).max(100).default(config.jobMaxAttemptsDefault),
});

const scheduleIdParamSchema = z.object({
  id: z.string().uuid(),
});

const schedulePatchSchema = z.object({
  // htmx posts urlencoded `enabled=false` (string); fetch sends real JSON.
  enabled: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]),
});

function validationFailed(error: z.ZodError): { error: string; details: unknown } {
  return { error: 'validation_error', details: error.flatten() };
}

export const schedulesRouter = Router();

// GET /api/schedules — list all schedules (public).
schedulesRouter.get('/', (req, res, next) => {
  const parsed = schedulePageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Invalid query.</div>`,
      json: validationFailed(parsed.error),
    });
    return;
  }
  listSchedules(pool, parsed.data.page, parsed.data.per_page)
    .then((result) => {
      respond(req, res, {
        html:
          result.schedules.length > 0
            ? `<p>${result.total} schedule(s).</p>`
            : `<div class="alert alert-info">No schedules found.</div>`,
        json: result,
      });
    })
    .catch(next);
});

// POST /api/schedules — create a recurring schedule (gated: state-changing).
schedulesRouter.post('/', requireToken, (req, res, next) => {
  const parsed = scheduleCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Invalid schedule.</div>`,
      json: validationFailed(parsed.error),
    });
    return;
  }
  createSchedule(pool, {
    name: parsed.data.name,
    cron: parsed.data.cron,
    jobType: parsed.data.job_type,
    payloadTemplate: parsed.data.payload_template,
    priority: parsed.data.priority,
    maxAttempts: parsed.data.max_attempts,
  })
    .then((schedule) => {
      respond(req, res, {
        status: 201,
        html: `<div class="alert alert-success">Schedule “${escapeHtml(schedule.name)}” created.</div>`,
        json: { schedule },
      });
    })
    .catch(next);
});

// PATCH /api/schedules/:id — enable/disable a schedule (gated: state-changing).
schedulesRouter.patch('/:id', requireToken, (req, res, next) => {
  const parsedParams = scheduleIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Invalid schedule id.</div>`,
      json: validationFailed(parsedParams.error),
    });
    return;
  }
  const parsedBody = schedulePatchSchema.safeParse(req.body);
  if (!parsedBody.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Body must be { "enabled": boolean }.</div>`,
      json: validationFailed(parsedBody.error),
    });
    return;
  }
  setScheduleEnabled(pool, parsedParams.data.id, parsedBody.data.enabled)
    .then((result) => {
      if (result.outcome === 'not-found') {
        respond(req, res, {
          status: 404,
          html: `<div class="alert alert-warning">Schedule not found.</div>`,
          json: { error: 'not_found' },
        });
      } else {
        respond(req, res, {
          html: `<div class="alert alert-success">Schedule ${result.schedule.enabled ? 'enabled' : 'disabled'}.</div>`,
          json: { schedule: result.schedule },
        });
      }
    })
    .catch(next);
});
