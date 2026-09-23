# QueueForge — Build Instructions

You are building **QueueForge**, a distributed job queue and scheduler. This file is the contract for *how* to build it. Read `agents/roadmap/SKILL.md` for the *order* to build it in. Do not deviate from the constraints below without flagging the trade-off explicitly. For writing any phase, create a new branch, name it with its functionality or phase's operations, then based on the phase work on it, thik mark the task which was done for tracking the progress bar, shows the dashboard reports on each phase operations. Never work all of the phase at once, work on one phase, then merge it with the main, shows the complete work reposrt to the user and only if the user is agree to next phase, then start preparing on it, remember always create new branches for new phase and merge them manually, no pr request.

## Hard constraints

- **Language/runtime:** Node.js 20+, TypeScript in `strict` mode. No `any` unless justified with a comment.
- **HTTP framework:** Express. Keep it thin — routes call into `src/jobs/*` and `src/db/*`, they don't contain business logic themselves.
- **Database access:** raw SQL only, via the `pg` package. **No ORM, no query builder.** Every query is parameterized (`$1, $2, ...`) — never string-interpolate user input into SQL, ever.
- **Migrations:** plain numbered `.sql` files in `src/db/migrations/` (e.g. `001_init.sql`, `002_schedules.sql`). Write a small migration runner (a `migrations` tracking table + apply-in-order script) — do not pull in a migration framework.
- **Frontend:** htmx + Bootstrap 5 via CDN + vanilla JS only. No React/Vue/build step for the client. Server renders HTML fragments for `HX-Request` requests and JSON for everything else — implement this as one small `respond(req, res, {html, json})` helper, not duplicated per-route logic.
- **Realtime:** Server-Sent Events at `GET /events`. Use a simple in-process `EventEmitter`-based bus (`src/events/bus.ts`) that both the worker pool and API routes publish to; the SSE route subscribes and writes `event: ...\ndata: ...\n\n` frames. Send a comment keepalive (`:\n\n`) every ~20s so proxies don't kill the connection.
- **Concurrency:** the worker pool runs as `worker_threads`, not separate OS processes or a separate Render service — see the Architecture section of the README for why. Worker count is `WORKER_CONCURRENCY` (env), default 4.
- **Job claiming:** must use this pattern (adapt column names to your schema, but keep the shape — this is the core correctness guarantee of the whole project):

```sql
UPDATE jobs
SET status = 'running',
    locked_by = $1,
    locked_at = now(),
    attempts = attempts + 1,
    updated_at = now()
WHERE id = (
  SELECT id FROM jobs
  WHERE status IN ('queued', 'retrying')
    AND run_at <= now()
  ORDER BY priority DESC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

  Run this inside a transaction. `SKIP LOCKED` is what makes concurrent workers never collide on the same row — do not replace it with `SELECT ... LIMIT 1` plus an application-level check, that reintroduces the race condition this project exists to demonstrate solving correctly.
- **Wake-up:** a Postgres trigger on `INSERT INTO jobs` (and on transition back to `queued`/`retrying`) calls `NOTIFY job_available`. A dedicated `pg` client in the worker pool `LISTEN`s on that channel and wakes idle workers. Keep a `POLL_INTERVAL_MS` (default 5000) fallback poll running regardless, in case a notification is ever missed — never rely on `LISTEN/NOTIFY` alone for correctness.
- **Retries:** exponential backoff — `run_at = now() + (base_delay_seconds * 2^attempts)` seconds, capped at a sane max (e.g. 1 hour). On exceeding `max_attempts`, transition to `dead` instead of `retrying`.
- **Idempotency:** `idempotency_key` has a unique constraint; enqueue is an upsert-or-409 — if the key already exists, return the existing job instead of erroring loudly, since the caller's intent (this job should exist) is already satisfied.
- **Graceful shutdown:** on `SIGTERM`/`SIGINT`: stop accepting new HTTP connections is optional, but the worker pool MUST stop claiming new jobs immediately and wait (with a timeout, e.g. 25s) for in-flight jobs to finish before `process.exit(0)`. Render sends `SIGTERM` on every deploy — untested shutdown handling means silently dropped jobs in production.
- **Validation:** every request body validated with `zod` at the route boundary before it touches the DB layer.
- **Logging:** `pino`, structured JSON, one logger instance passed down — no `console.log` in application code.
- **Rate limiting:** the public `POST /api/jobs` endpoint is rate-limited per IP (in-memory token bucket is fine for a single-instance deploy) — this is a public demo, protect it from casual abuse.
- **Auth — read-public, write-gated:** anyone can *watch* the dashboard live (that's the point of a portfolio demo); only state-changing actions require `DASHBOARD_TOKEN`, and only when it's set. Implement as one small middleware, not per-route checks:

  ```ts
  // src/middleware/requireToken.ts
  export function requireToken(req: Request, res: Response, next: NextFunction) {
    if (!config.dashboardToken) return next(); // unset = fully open, local dev default

    const header = req.header('authorization'); // "Bearer <token>"
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const provided = bearer ?? req.cookies?.qf_token;

    if (provided === config.dashboardToken) return next();

    return respond(req, res, {
      status: 401,
      html: `<div class="alert alert-danger">Unauthorized — this action needs the dashboard token.</div>`,
      json: { error: 'unauthorized' },
    });
  }
  ```

  Apply `requireToken` **only** to these routes — every other route (including `/`, `/jobs`, `/jobs/:id`, `/dlq`, `/schedules`, `/events`, `/api/stats`, `/health`) stays public, unauthenticated, no exceptions:

  | Route | Gated? |
  |---|---|
  | `POST /api/jobs` | yes |
  | `POST /api/jobs/:id/cancel` | yes |
  | `POST /api/dlq/:id/replay` | yes |
  | `POST /api/schedules`, `PATCH /api/schedules/:id` | yes |
  | everything else | no |

  Token entry: add a small non-blocking control in the dashboard nav — a "Manage" button opening a Bootstrap modal with one input (`Authorization` value), storing it in `localStorage` (`qf_token`) and sending it as `Authorization: Bearer <token>` on subsequent mutating `fetch`/htmx calls (`hx-headers='{"Authorization": "Bearer ..."}"` set dynamically via a small vanilla JS snippet reading `localStorage`). No server-side session, no `/login` page, no cookie needed unless you specifically want the cookie fallback in the middleware above for curl convenience — the header path is the primary one.

  If `DASHBOARD_TOKEN` is unset (local dev), the "Manage" control can be hidden entirely since every action already succeeds without it.

## Conventions

- Folder structure and file names should match the tree in `README.md` — don't reorganize without a reason.
- One export per file where reasonable; keep `src/jobs/claim.ts` and `src/jobs/worker.ts` small and testable in isolation from Express.
- Environment variables are read once at startup into a typed `config` object (`src/config.ts`) — never read `process.env` scattered through the codebase.
- Every SQL migration is forward-only and idempotent-safe to re-run (`CREATE TABLE IF NOT EXISTS`, etc.) during local dev restarts.
- `package.json` must define these scripts, since `Dockerfile`, `docker-compose.yml`, and `ci.yaml` all assume them:
  - `dev` — hot-reload dev server (e.g. `tsx watch src/server.ts`)
  - `build` — `tsc` to `dist/`
  - `start` — `node dist/server.js`
  - `lint` — eslint
  - `typecheck` — `tsc --noEmit`
  - `test` — whatever test runner you choose (vitest recommended — fast, TS-native)
  - `migrate` — run pending SQL migrations against `DATABASE_URL`

## Testing expectations

At minimum, cover:
1. **The claim race condition** — spin up N concurrent calls to the claim query against a handful of queued jobs and assert no job is claimed twice and none are lost.
2. **Retry/backoff transitions** — a job that fails moves to `retrying` with a future `run_at`, and to `dead` once `max_attempts` is exceeded.
3. **Idempotency** — enqueuing the same `idempotency_key` twice returns the same job id, not a duplicate row.
4. A smoke test that boots the app and hits `GET /health`.

Run tests against a real Postgres (docker-compose / CI service container), not a mock — the correctness this project demonstrates lives in the SQL, so mocking the DB defeats the point.

## Definition of done (per feature)

- [ ] Route validates input with zod
- [ ] DB access is parameterized SQL in `src/db`/`src/jobs`, not inline in the route
- [ ] State-changing actions emit a `job.transition` event on the bus (and thus reach the SSE dashboard)
- [ ] htmx fragment + JSON response both work from the same route
- [ ] If the route mutates state (create/cancel/replay/schedule), it's wrapped in `requireToken` — if it only reads, it is NOT gated
- [ ] Covered by at least one test if it touches job state or concurrency
