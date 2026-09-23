import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { respond } from '../http/respond.js';

/**
 * Read-public, write-gated: anyone can watch, but state-changing routes
 * require `DASHBOARD_TOKEN` when it is set. Unset = fully open (local dev).
 * Mounted per-route on mutating endpoints only — never on reads.
 */
export function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (!config.dashboardToken) {
    next();
    return;
  }

  const header = req.header('authorization'); // "Bearer <token>"
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  // Cookie fallback for curl convenience; the Authorization header is primary.
  // (`req.cookies` is untyped without the cookie-parser augmentation.)
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const provided = bearer ?? cookies?.['qf_token'];

  if (provided === config.dashboardToken) {
    next();
    return;
  }

  respond(req, res, {
    status: 401,
    html: `<div class="alert alert-danger">Unauthorized — this action needs the dashboard token.</div>`,
    json: { error: 'unauthorized' },
  });
}
