# QueueForge

**A distributed job queue & scheduler, built from scratch on raw PostgreSQL — no Redis, no Bull, no ORM.**

Node.js + TypeScript · htmx + Bootstrap dashboard · Server-Sent Events · Postgres `SKIP LOCKED` job claiming · retries with backoff · dead-letter queue · cron-style recurring jobs.

> Third in a series of mini backend services built to demonstrate concurrency, reliability, and data-layer fundamentals across different stacks:
> - **Pulse Monitor** (Go) — concurrent worker pool + per-domain rate limiting for URL health checks
> - **HookRelay** (ASP.NET Core) — webhook capture, HMAC signing, retries, dead-letter queue
> - **QueueForge** (this repo, Node.js/TypeScript) — a job queue engine that proves you don't need a broker to build one

## Why this exists

Most "job queue" side projects wrap BullMQ or Celery. This one **is** the queue — the whole point is to show the underlying mechanics: safe concurrent job claiming with row-level locks, backoff/retry state machines, idempotency, and graceful shutdown, all implemented with parameterized raw SQL against Postgres.

## Features

- **Enqueue jobs** via REST API with type, JSON payload, priority, delayed `run_at`, max attempts, and an optional idempotency key to prevent duplicate submission
- **Concurrent worker pool** using `worker_threads`, each claiming jobs with `SELECT ... FOR UPDATE SKIP LOCKED` — no two workers ever grab the same job, no external broker required
- **Instant wake-up** via Postgres `LISTEN/NOTIFY` — workers block on a notification channel instead of tight-polling, falling back to a slow poll interval as a safety net
- **Retry with exponential backoff** per job, up to a configurable max attempt count
- **Dead-letter queue (DLQ)** for permanently failed jobs, inspectable and replayable from the dashboard
- **Recurring jobs** defined with a cron expression, ticked by an in-process scheduler
- **Live dashboard** (htmx + Bootstrap + vanilla JS) — queue depth, throughput, per-status counts, and a live job feed, all pushed over SSE with no client-side JS framework
- **Per-job-type concurrency limits** so one noisy job type can't starve the others
- **Graceful shutdown** — on `SIGTERM` (which Render sends on every deploy) the app stops claiming new jobs and lets in-flight jobs finish before exiting
- Ships as a **single free-tier Render web service** — see [Architecture](#architecture) for why, and how to split it up later

## Architecture

```
                        ┌─────────────────────────────────────────┐
                        │           QueueForge (1 process)         │
   Browser  ───HTTP───▶ │  Express API  ── htmx fragments/JSON     │
   (htmx +              │       │                                  │
   Bootstrap)  ◀──SSE── │  Event bus ◀── job state transitions     │
                        │       │                                  │
                        │  Worker pool (worker_threads, N workers) │
                        │       │  claims via SKIP LOCKED           │
                        │       │  wakes via LISTEN/NOTIFY          │
                        │  Cron ticker (recurring job scheduler)   │
                        └───────────────┬───────────────────────────┘
                                        │ raw SQL (pg, parameterized)
                                        ▼
                              Neon (serverless Postgres)
```

**Why everything runs in one process:** Render's free plan only offers free **Web Services** — Background Workers and Cron Jobs are paid-only. Rather than pretend otherwise, the worker pool and cron scheduler run as `worker_threads` inside the same web service. The claiming logic itself doesn't care where it runs — on a paid plan, you'd lift `src/worker/` into its own `Background Worker` service pointed at the same `DATABASE_URL` with zero code changes, since coordination happens entirely through Postgres row locks, not shared memory.

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20, TypeScript (strict mode) |
| HTTP | Express |
| Database driver | `pg` — raw parameterized SQL, no ORM, hand-written migrations |
| Database | PostgreSQL (Neon serverless, free tier) |
| Frontend | htmx + Bootstrap 5 (CDN) + vanilla JS for `EventSource` wiring |
| Realtime | Server-Sent Events (`/events`) |
| Concurrency | `worker_threads` job workers, `LISTEN/NOTIFY` wake-up |
| Validation | zod |
| Logging | pino (structured JSON logs) |
| Containerization | Docker, docker-compose (local dev) |
| CI | GitHub Actions — lint, typecheck, build, test against a real Postgres container |
| Deployment | Render (free web service, Docker runtime) + Neon (Postgres) |

## Project structure

```
queueforge/
├── agents/
│   ├── instructions/SKILL.md   # build conventions & hard constraints for the coding agent
│   └── roadmap/SKILL.md        # phased build plan
├── src/
│   ├── server.ts                # Express app + HTTP entrypoint
│   ├── db/
│   │   ├── pool.ts               # pg Pool, LISTEN client
│   │   └── migrations/*.sql      # numbered, raw SQL migrations
│   ├── jobs/
│   │   ├── enqueue.ts
│   │   ├── claim.ts              # the SKIP LOCKED query lives here
│   │   ├── worker.ts             # worker_threads entry
│   │   └── scheduler.ts          # cron ticker for recurring jobs
│   ├── routes/                   # REST + htmx fragment routes
│   ├── events/bus.ts             # in-process event bus feeding SSE
│   └── views/                    # server-rendered HTML fragments (htmx targets)
├── Dockerfile
├── docker-compose.yml
├── render.yaml
├── .env.sample
└── .github/workflows/ci.yaml
```

## Database schema (summary)

| Table | Purpose |
|---|---|
| `jobs` | one row per job: `status`, `priority`, `payload jsonb`, `attempts`, `max_attempts`, `run_at`, `locked_by`, `idempotency_key` |
| `job_events` | append-only status-transition log per job, powers the timeline view and SSE feed |
| `schedules` | recurring job definitions: cron expression, job type, payload template, enabled flag |
| `job_type_limits` | optional per-type max concurrency overrides |

Full DDL lives in `src/db/migrations/`. Job status flow:

```
queued → running → succeeded
                 → retrying → queued (after backoff delay)
                 → dead   (max attempts exceeded → DLQ, replayable back to queued)
```

## API reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/jobs` | Enqueue a job `{ type, payload, priority?, run_at?, max_attempts?, idempotency_key? }` |
| `GET` | `/api/jobs` | List jobs — filter by `status`, `type`; paginated |
| `GET` | `/api/jobs/:id` | Job detail + full event timeline |
| `POST` | `/api/jobs/:id/cancel` | Cancel a queued (not yet running) job |
| `GET` | `/api/dlq` | List dead-lettered jobs |
| `POST` | `/api/dlq/:id/replay` | Move a dead job back to `queued`, reset attempts |
| `POST` | `/api/schedules` | Create a recurring job schedule |
| `GET` | `/api/schedules` | List schedules |
| `PATCH` | `/api/schedules/:id` | Enable/disable a schedule |
| `GET` | `/api/stats` | Queue depth, throughput, per-status counts |
| `GET` | `/events` | SSE stream of job transitions + stats ticks |
| `GET` | `/health` | Liveness/readiness probe for Render |

All routes respond with an HTML fragment when called with an `HX-Request` header (for the htmx dashboard) and JSON otherwise.

## SSE events

| Event name | Payload | Fired when |
|---|---|---|
| `job.transition` | `{ id, from, to, type }` | A job changes status |
| `stats.tick` | `{ queued, running, succeeded, failed, dead, throughputPerMin }` | Every few seconds |

## Getting started (local)

```bash
cp .env.sample .env          # defaults work as-is for docker-compose
docker compose up --build
# App:      http://localhost:3000
# Adminer:  http://localhost:8080  (optional DB inspector — see docker-compose.yml)
```

Migrations run automatically on container start.

## Environment variables

See [`.env.sample`](./.env.sample) for the full list with defaults — includes `DATABASE_URL`, `WORKER_CONCURRENCY`, `POLL_INTERVAL_MS`, `JOB_MAX_ATTEMPTS_DEFAULT`, `ENQUEUE_RATE_LIMIT_PER_MIN`, and an optional `DASHBOARD_TOKEN` to lightly protect the public demo dashboard.

## Deployment (Render + Neon)

1. Create a free Postgres database at [neon.tech](https://neon.tech) and copy the pooled connection string.
2. Push this repo to GitHub.
3. In Render, choose **New → Blueprint**, point it at the repo — `render.yaml` provisions the web service.
4. Set `DATABASE_URL` (and `DASHBOARD_TOKEN` if used) in the Render dashboard as secret env vars — these are marked `sync: false` in `render.yaml` on purpose.
5. Deploy. Render sends `SIGTERM` on every redeploy, so confirm graceful shutdown drains in-flight jobs before it restarts.

**Note on SSE + Render:** Render's proxy supports long-lived streaming connections, but make sure the app disables response buffering (`Content-Encoding` off, `X-Accel-Buffering: no`, periodic comment-keepalive) so `/events` isn't chunked into silence by intermediary proxies.

## Design decisions

- **`FOR UPDATE SKIP LOCKED`** instead of a message broker — Postgres already gives you exactly-once claiming for free if you use row locks correctly.
- **`LISTEN/NOTIFY`** instead of tight polling — a trigger fires `NOTIFY` on insert; workers `LISTEN` and wake immediately, with a slow poll as a fallback in case a notification is ever missed.
- **In-process `worker_threads`, not a separate service** — a direct consequence of Render's free-tier limits (see Architecture). Documented as a trade-off, not hidden.
- **Idempotency keys** — a unique constraint on `idempotency_key` means retried client submissions never double-enqueue.
- **Graceful shutdown** — required for a platform that redeploys by sending `SIGTERM`; without it, in-flight jobs would be silently dropped mid-execution on every deploy.

## Roadmap / status

See [`agents/roadmap/SKILL.md`](./agents/roadmap/SKILL.md) for the phased build plan and current status.

## License

MIT
