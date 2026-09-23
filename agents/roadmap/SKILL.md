# QueueForge — Roadmap

Build in this order. Each phase should leave the app in a runnable state. Follow the constraints in `agents/instructions/SKILL.md` throughout — this file is sequencing only, not a second source of rules.

## Phase 0 — Bootstrap
- [ ] `package.json`, `tsconfig.json` (strict), eslint + prettier config
- [ ] Folder skeleton matching the README tree
- [ ] `src/config.ts` reading env vars into a typed object, with `.env.sample` kept in sync
- [ ] `src/server.ts` — Express app boots, `GET /health` returns 200

## Phase 1 — Database layer
- [ ] `src/db/pool.ts` — `pg.Pool` using `DATABASE_URL`
- [ ] Migration runner + `001_init.sql`: `jobs`, `job_events` tables, indexes on `(status, run_at)` and `(type)`
- [ ] `002_notify_trigger.sql`: trigger + function that `NOTIFY job_available` on relevant insert/update
- [ ] `003_schedules.sql`: `schedules`, `job_type_limits` tables
- [ ] `npm run migrate` works against local docker-compose Postgres

## Phase 2 — Core job API
- [ ] `POST /api/jobs` (enqueue, with idempotency handling)
- [ ] `GET /api/jobs`, `GET /api/jobs/:id`
- [ ] `POST /api/jobs/:id/cancel`
- [ ] zod validation on all inputs
- [ ] Unit tests for idempotency behavior

## Phase 3 — Worker engine
- [ ] `src/jobs/claim.ts` — the `SKIP LOCKED` claim query, isolated and testable
- [ ] `src/jobs/worker.ts` — `worker_threads` pool, `LISTEN/NOTIFY` wake-up + poll fallback
- [ ] Retry/backoff transition logic; DLQ transition on max attempts
- [ ] Graceful shutdown on `SIGTERM`/`SIGINT`
- [ ] Concurrency test: N parallel claims never double-assign a job

## Phase 4 — Dashboard shell (htmx + Bootstrap)
- [ ] Base layout template, Bootstrap via CDN
- [ ] `GET /` — stats cards (queued/running/succeeded/failed/dead), recent jobs table
- [ ] `GET /jobs`, `GET /jobs/:id` (timeline view from `job_events`)
- [ ] "Enqueue test job" form on the dashboard for live demo purposes

## Phase 5 — Live updates (SSE)
- [ ] `src/events/bus.ts` in-process event bus
- [ ] `GET /events` SSE endpoint with keepalive comments
- [ ] Dashboard wired via htmx SSE extension (or vanilla `EventSource` + DOM patch) for `job.transition` and `stats.tick`
- [ ] `GET /api/stats` backing the initial page load (SSE only patches deltas)

## Phase 6 — DLQ & replay
- [ ] `GET /api/dlq`, `GET /dlq` page
- [ ] `POST /api/dlq/:id/replay` — resets attempts, moves job back to `queued`
- [ ] Replay button wired via htmx on the DLQ page

## Phase 7 — Recurring jobs (cron)
- [ ] `POST /api/schedules`, `GET /api/schedules`, `PATCH /api/schedules/:id`
- [ ] In-process scheduler tick (e.g. every 30s) that evaluates cron expressions and enqueues due job instances
- [ ] `GET /schedules` management page

## Phase 8 — Hardening
- [ ] Per-IP rate limiting on `POST /api/jobs`
- [ ] `helmet` security headers
- [ ] Optional `DASHBOARD_TOKEN` auth gate
- [ ] Structured `pino` logging with request IDs
- [ ] Central error-handling middleware, consistent JSON error shape

## Phase 9 — Docker & local dev
- [ ] Confirm `Dockerfile` multi-stage build produces a small runnable image
- [ ] Confirm `docker-compose.yml` boots app + Postgres (+ optional Adminer) cleanly from a clean checkout
- [ ] Seed script for demo data (a handful of jobs in various states) — nice for first-run screenshots

## Phase 10 — CI
- [ ] `.github/workflows/ci.yaml` green on a clean PR: lint, typecheck, build, test (against a Postgres service container)

## Phase 11 — Deploy
- [ ] Provision Neon Postgres, run migrations against it
- [ ] Deploy via `render.yaml` blueprint on Render's free plan
- [ ] Verify SSE stays open behind Render's proxy (no buffering, keepalive visible in dev tools)
- [ ] Verify a redeploy (`SIGTERM`) doesn't drop an in-flight job — trigger one manually while a slow test job is running
- [ ] Update README screenshots/status, tag `v1.0.0`

## Status

_Update this section as phases complete — not pre-filled, since the agent building this owns tracking its own progress._
