import express from 'express';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { createRateLimiter } from '../src/middleware/rateLimit.js';

describe('rate limiting', () => {
  it('allows bursts up to the max, then 429s with Retry-After', async () => {
    const probe = express();
    probe.use(createRateLimiter({ maxRequests: 3, windowMs: 60_000 }));
    probe.post('/enqueue', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    const agent = request(probe);
    for (let i = 0; i < 3; i += 1) {
      const res = await agent.post('/enqueue').send({});
      expect(res.status).toBe(200);
    }
    const limited = await agent.post('/enqueue').send({});
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('rate_limited');
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);

    const limitedHtml = await agent.post('/enqueue').set('HX-Request', 'true').send({});
    expect(limitedHtml.status).toBe(429);
    expect(limitedHtml.text).toContain('Rate limit');
  });
});

describe('security headers', () => {
  it('sets helmet headers with a dashboard-compatible CSP', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['content-security-policy']).toMatch(/unpkg\.com/);
    expect(res.headers['content-security-policy']).toMatch(/cdn\.jsdelivr\.net/);
    expect(res.headers['content-security-policy']).toMatch(/'unsafe-inline'/);
  });
});

describe('request ids', () => {
  it('echoes the request id in a response header', async () => {
    const res = await request(app).get('/health').set('x-request-id', 'probe-123');
    expect(res.headers['x-request-id']).toBe('probe-123');
  });

  it('generates one when the client sends none', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('central error handling', () => {
  it('returns the consistent 404 shape with the request id', async () => {
    const res = await request(app).get('/no/such/route').set('x-request-id', 'missing-1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found', requestId: 'missing-1' });
  });

  it('maps thrown HttpErrors to status + code without leaking internals', async () => {
    const probe = express();
    probe.use(express.json());
    probe.get('/boom', () => {
      throw Object.assign(new Error('kaboom'), { status: 503, code: 'unavailable' });
    });
    probe.use(notFoundHandler);
    probe.use(errorHandler);
    const res = await request(probe).get('/boom').set('x-request-id', 'boom-1');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('unavailable');
    expect(res.body.message).toBe('kaboom');
    expect(res.body.requestId).toBe('boom-1');
  });
});
