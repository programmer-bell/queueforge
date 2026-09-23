import type { Request, Response } from 'express';

interface RespondOptions {
  html: string;
  json: unknown;
  status?: number;
}

/**
 * The single content-negotiation point: htmx (`HX-Request` header) gets a
 * server-rendered HTML fragment, everyone else gets JSON. Routes never
 * branch on this themselves.
 */
export function respond(req: Request, res: Response, options: RespondOptions): void {
  const status = options.status ?? 200;
  if (req.header('HX-Request') !== undefined) {
    res.status(status).type('html').send(options.html);
  } else {
    res.status(status).json(options.json);
  }
}
