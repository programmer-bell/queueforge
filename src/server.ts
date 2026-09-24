import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { stopStatsTicker, startStatsTicker } from './events/statsTicker.js';
import { shutdownWorkerPool, startWorkerPool } from './jobs/poolManager.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { eventsRouter } from './routes/events.js';
import { dlqRouter } from './routes/dlq.js';
import { schedulesRouter } from './routes/schedules.js';
import { jobsRouter } from './routes/jobs.js';
import { pagesRouter } from './routes/pages.js';
import { statsRouter } from './routes/stats.js';

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  // Security headers. CSP allows the dashboard's inline scripts plus the
  // pinned Bootstrap/htmx CDNs — everything else stays locked down.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'unpkg.com', 'cdn.jsdelivr.net'],
          styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
    }),
  );

  // Structured request logs with IDs; honors an incoming X-Request-Id.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => {
        const incoming = req.headers['x-request-id'];
        return typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
      },
    }),
  );
  app.use((req, res, next) => {
    const id: unknown = (req as { id?: unknown }).id;
    if (typeof id === 'string') res.setHeader('x-request-id', id);
    next();
  });

  // Liveness/readiness probe for Render (healthCheckPath: /health).
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/jobs', jobsRouter);
  app.use('/api/dlq', dlqRouter);
  app.use('/api/schedules', schedulesRouter);
  app.use('/api/stats', statsRouter);
  app.use('/events', eventsRouter);
  app.use('/', pagesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();

const isMainModule =
  process.argv[1]?.endsWith('server.ts') === true ||
  process.argv[1]?.endsWith('server.js') === true;

// Exported `app` lets tests import the Express instance without binding a port
// or starting workers — the pool only boots in the real entrypoint below.
if (isMainModule && process.env['VITEST'] === undefined) {
  await startWorkerPool();
  startStatsTicker();
  startScheduler();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, nodeEnv: config.nodeEnv }, 'queueforge listening');
  });

  // Graceful shutdown (Render sends SIGTERM on every deploy): stop claiming
  // immediately, let in-flight jobs drain, then close HTTP and exit.
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, 'shutdown signal received, draining workers');
    await shutdownWorkerPool();
    stopScheduler();
    stopStatsTicker();
    await closePool();
    server.closeAllConnections?.();
    server.close((err) => {
      if (err !== undefined) {
        logger.error({ err }, 'error while closing HTTP server');
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}
