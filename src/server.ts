import express, { type Express } from 'express';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { stopStatsTicker, startStatsTicker } from './events/statsTicker.js';
import { shutdownWorkerPool, startWorkerPool } from './jobs/poolManager.js';
import { logger } from './logger.js';
import { eventsRouter } from './routes/events.js';
import { dlqRouter } from './routes/dlq.js';
import { jobsRouter } from './routes/jobs.js';
import { pagesRouter } from './routes/pages.js';
import { statsRouter } from './routes/stats.js';

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  // Liveness/readiness probe for Render (healthCheckPath: /health).
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/jobs', jobsRouter);
  app.use('/api/dlq', dlqRouter);
  app.use('/api/stats', statsRouter);
  app.use('/events', eventsRouter);
  app.use('/', pagesRouter);

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
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, nodeEnv: config.nodeEnv }, 'queueforge listening');
  });

  // Graceful shutdown (Render sends SIGTERM on every deploy): stop claiming
  // immediately, let in-flight jobs drain, then close HTTP and exit.
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, 'shutdown signal received, draining workers');
    await shutdownWorkerPool();
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
