import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { respond } from '../http/respond.js';
import { listDeadJobs } from '../jobs/dlq.js';
import { getJobDetail } from '../jobs/getJob.js';
import { listJobs } from '../jobs/listJobs.js';
import { listSchedules } from '../jobs/schedules.js';
import { getStats } from '../jobs/stats.js';
import { dashboardPage } from '../views/dashboard.js';
import { dlqPageFragment } from '../views/dlq.js';
import {
  jobDetailFragment,
  jobFilterFormFragment,
  jobTableFragment,
  paginationFragment,
} from '../views/jobs.js';
import { layout } from '../views/layout.js';
import { schedulesPageFragment } from '../views/schedules.js';
import { idParamSchema, listQuerySchema } from './jobs.js';
import { schedulePageQuerySchema } from './schedules.js';

/** Public dashboard pages. htmx → fragment, direct visit → full page, API clients → JSON. */

export const pagesRouter = Router();

// GET / — stats cards, enqueue test-job form, recent jobs.
pagesRouter.get('/', (_req, res, next) => {
  Promise.all([getStats(pool), listJobs(pool, { page: 1, perPage: 10 })])
    .then(([stats, recent]) => {
      const fragment = dashboardPage(stats, recent.jobs);
      respond(_req, res, {
        html: fragment,
        json: { stats, recent: recent.jobs },
        page: layout('Dashboard', 'dashboard', fragment),
      });
    })
    .catch(next);
});

// GET /jobs — filter form + jobs table + pagination.
pagesRouter.get('/jobs', (req, res, next) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Invalid query.</div>`,
      json: { error: 'validation_error', details: parsed.error.flatten() },
      page: layout('Jobs', 'jobs', `<div class="alert alert-danger">Invalid query.</div>`),
    });
    return;
  }
  const { status, type, page, per_page: perPage } = parsed.data;
  listJobs(pool, {
    ...(status !== undefined ? { status } : {}),
    ...(type !== undefined ? { type } : {}),
    page,
    perPage,
  })
    .then((result) => {
      const fragment =
        jobFilterFormFragment({ ...(status ? { status } : {}), ...(type ? { type } : {}) }) +
        jobTableFragment(result.jobs) +
        paginationFragment(
          '/jobs',
          { ...(status ? { status } : {}), ...(type ? { type } : {}) },
          result.page,
          result.perPage,
          result.total,
        );
      respond(req, res, {
        html: fragment,
        json: result,
        page: layout('Jobs', 'jobs', fragment),
      });
    })
    .catch(next);
});

// GET /jobs/:id — job detail + event timeline.
pagesRouter.get('/jobs/:id', (req, res, next) => {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Invalid job id.</div>`,
      json: { error: 'validation_error', details: parsed.error.flatten() },
      page: layout('Job', 'jobs', `<div class="alert alert-danger">Invalid job id.</div>`),
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
          page: layout(
            'Job not found',
            'jobs',
            `<div class="alert alert-warning">Job not found.</div>`,
          ),
        });
        return;
      }
      const fragment = `<a href="/jobs" hx-get="/jobs" hx-target="#page" hx-push-url="true" class="btn btn-sm btn-outline-secondary mb-3">‹ All jobs</a>${jobDetailFragment(detail.job, detail.events)}`;
      respond(req, res, {
        html: fragment,
        json: detail,
        page: layout(`Job ${detail.job.id.slice(0, 8)}`, 'jobs', fragment),
      });
    })
    .catch(next);
});

// GET /dlq — dead-letter queue page with replay buttons (public).
const dlqPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

pagesRouter.get('/dlq', (req, res, next) => {
  const parsed = dlqPageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Invalid query.</div>`,
      json: { error: 'validation_error', details: parsed.error.flatten() },
      page: layout('DLQ', 'dlq', `<div class="alert alert-danger">Invalid query.</div>`),
    });
    return;
  }
  listDeadJobs(pool, parsed.data.page, parsed.data.per_page)
    .then((result) => {
      const fragment = dlqPageFragment(result.jobs, result.page, result.perPage, result.total);
      respond(req, res, {
        html: fragment,
        json: result,
        page: layout('DLQ', 'dlq', fragment),
      });
    })
    .catch(next);
});

// GET /schedules — management page (public).
pagesRouter.get('/schedules', (req, res, next) => {
  const parsed = schedulePageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    respond(req, res, {
      status: 400,
      html: `<div class="alert alert-danger">Invalid query.</div>`,
      json: { error: 'validation_error', details: parsed.error.flatten() },
      page: layout(
        'Schedules',
        'schedules',
        `<div class="alert alert-danger">Invalid query.</div>`,
      ),
    });
    return;
  }
  listSchedules(pool, parsed.data.page, parsed.data.per_page)
    .then((result) => {
      const fragment = schedulesPageFragment(
        result.schedules,
        result.page,
        result.perPage,
        result.total,
      );
      respond(req, res, {
        html: fragment,
        json: result,
        page: layout('Schedules', 'schedules', fragment),
      });
    })
    .catch(next);
});
