import type { Request, Response } from 'express';

interface RespondOptions {
  html: string;
  json: unknown;
  status?: number;
  /** Full document for direct visits. API routes omit it and fall back to JSON. */
  page?: string;
}

/**
 * The single content-negotiation point:
 * - htmx (`HX-Request` header) → server-rendered HTML fragment,
 * - direct page visit → full HTML document (page routes only),
 * - everyone else → JSON.
 * Routes never branch on this themselves.
 */
export function respond(req: Request, res: Response, options: RespondOptions): void {
  const status = options.status ?? 200;
  if (req.header('HX-Request') !== undefined) {
    res.status(status).type('html').send(options.html);
  } else if (options.page !== undefined) {
    res.status(status).type('html').send(options.page);
  } else {
    res.status(status).json(options.json);
  }
}
