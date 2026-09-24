import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { respond } from '../http/respond.js';

export interface HttpError extends Error {
  status?: number;
  code?: string;
}

function requestIdOf(req: Request): string | undefined {
  // pino-http assigns `req.id` (number | string | object); surface strings only.
  // Fall back to the inbound header so the id survives even without the
  // logging middleware (e.g. minimal mounts, tests).
  const id: unknown = (req as { id?: unknown }).id;
  if (typeof id === 'string') return id;
  const header = req.header('x-request-id');
  return typeof header === 'string' && header.length > 0 ? header : undefined;
}

function logError(req: Request, err: unknown, requestId: string | undefined): void {
  const log: unknown = (req as { log?: unknown }).log;
  if (typeof log === 'object' && log !== null && 'error' in log) {
    (log as { error: (...args: unknown[]) => void }).error({ err, requestId });
  }
}

/**
 * Consistent JSON error shape: `{ error: <code>, message?, details?, requestId? }`.
 * Existing route-level errors already use a flat `error` code string — this
 * middleware extends the same convention to 404s and uncaught errors instead
 * of inventing a second envelope. Stack traces / internals never leak in
 * production; the request id lets log correlation do the talking.
 */
export function notFoundHandler(req: Request, res: Response): void {
  respond(req, res, {
    status: 404,
    html: `<div class="alert alert-warning">Not found.</div>`,
    json: { error: 'not_found', requestId: requestIdOf(req) },
  });
}

// Express 4 requires the 4-arg signature to recognize error middleware.
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId = requestIdOf(req);
  logError(req, err, requestId);
  if (res.headersSent) return;

  const status =
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
      ? ((err as { status: number }).status as number)
      : 500;
  const code =
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
      ? ((err as { code: string }).code as string)
      : 'internal_error';
  const message =
    config.nodeEnv === 'production'
      ? status === 500
        ? 'Internal server error.'
        : ((err as Error)?.message ?? 'Request failed.')
      : ((err as Error)?.message ?? 'Request failed.');

  respond(req, res, {
    status,
    html: `<div class="alert alert-danger">${escapeHtml(message)}</div>`,
    json: { error: code, message, requestId },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
