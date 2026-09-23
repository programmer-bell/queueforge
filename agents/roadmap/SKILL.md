# QueueForge — Roadmap

Build in this order. Each phase should leave the app in a runnable state. Follow the constraints in `agents/instructions/SKILL.md` throughout — this file is sequencing only, not a second source of rules.

## Phase 0 — Bootstrap
- [x] `package.json`, `tsconfig.json` (strict), eslint + prettier config
- [x] Folder skeleton matching the README tree
- [x] `src/config.ts` reading env vars into a typed object, with `.env.sample` kept in sync
- [x] `src/server.ts` — Express app boots, `GET /health` returns 200

## Phase 1 — Database layer
- [x] `src/db/pool.ts` — `pg.Pool` using `DATABASE_URL`
- [x] Migration runner + `001_init.sql`: `jobs`, `job_events` tables, indexes on `(status, run_at)` and `(type)`
- [x] `002_notify_trigger.sql`: trigger + function that `NOTIFY job_available` on relevant insert/update
- [x] `003_schedules.sql`: `schedules`, `job_type_limits` tables
- [x] `npm run migrate` works against local docker-compose Postgres

## Phase 2 — Core job API
- [x] `POST /api/jobs` (enqueue, with idempotency handling)
- [x] `GET /api/jobs`, `GET /api/jobs/:id`
- [x] `POST /api/jobs/:id/cancel`
- [x] zod validation on all inputs
- [x] Unit tests for idempotency behavior

## Phase 3 — Worker engine
- [x] `src/jobs/claim.ts` — the `SKIP LOCKED` claim query, isolated and testable
- [x] `src/jobs/worker.ts` — `worker_threads` pool, `LISTEN/NOTIFY` wake-up + poll fallback
- [x] Retry/backoff transition logic; DLQ transition on max attempts
- [x] Graceful shutdown on `SIGTERM`/`SIGINT`
- [x] Concurrency test: N parallel claims never double-assign a job

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

- Phase 0 complete (branch `phase-0-bootstrap`, merged): Express boots, `GET /health` → 200, typed `config` from env, `.env.sample` in sync.
- Phase 1 complete (branch `phase-1-database-layer`, merged): `pool.ts` + dedicated LISTEN client, migration runner with `migrations` tracking table, `001_init` (`jobs`, `job_events`, indexes), `002_notify_trigger` (`NOTIFY job_available`), `003_schedules` (`schedules`, `job_type_limits`); verified against docker-compose Postgres incl. NOTIFY round-trip and idempotent re-runs; `tests/db.test.ts` (4 tests) green.
- Phase 2 complete (branch `phase-2-job-api`, merged): enqueue with idempotency upsert-or-return, filtered/paginated list, detail + event timeline, cancel for queued jobs only; zod at every boundary, single `respond()` htmx/JSON helper, `requireToken` on mutations, `job.transition` bus events on enqueue/cancel; `tests/jobs.test.ts` (12 tests) incl. token-gating green.
- Phase 3 complete (branch `phase-3-worker`, merged): `SKIP LOCKED` claim (CTE shape + per-type limits in-txn), `worker_threads` pool with LISTEN wake + poll fallback, exp-backoff retry → `dead` DLQ, `SIGTERM` drain shutdown; `tests/claim.test.ts` (9) + `tests/worker.test.ts` (4, incl. live drain/timeout) green; `vitest.config.ts` serializes files on one shared DB. Phases 4–11 not started.
