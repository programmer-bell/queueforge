import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { respond } from '../http/respond.js';

export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Per-IP fixed-window rate limiter (in-memory — fine for a single-instance
 * deploy). Mounted on the public `POST /api/jobs` endpoint to blunt casual
 * abuse of the demo. Each limiter instance owns its buckets, so tests can
 * construct small ones without touching the shared route instance.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  function middleware(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    let bucket = buckets.get(ip);
    if (bucket === undefined || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(ip, bucket);
    }
    bucket.count += 1;
    if (bucket.count > options.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      respond(req, res, {
        status: 429,
        html: `<div class="alert alert-warning">Rate limit exceeded — try again shortly.</div>`,
        json: { error: 'rate_limited', retryAfterSec },
      });
      return;
    }
    next();
  }

  middleware.clear = (): void => {
    buckets.clear();
  };

  return middleware;
}

/** Shared instance for the public enqueue endpoint (per-IP, per-minute). */
export const enqueueRateLimiter = createRateLimiter({
  maxRequests: config.enqueueRateLimitPerMin,
  windowMs: 60_000,
});
