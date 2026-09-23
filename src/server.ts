import express, { type Express } from 'express';
import { config } from './config.js';
import { logger } from './logger.js';

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  // Liveness/readiness probe for Render (healthCheckPath: /health).
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}

export const app = createApp();

const isMainModule =
  process.argv[1]?.endsWith('server.ts') === true ||
  process.argv[1]?.endsWith('server.js') === true;

// Exported `app` lets tests import the Express instance without binding a port.
if (isMainModule && process.env['VITEST'] === undefined) {
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, nodeEnv: config.nodeEnv }, 'queueforge listening');
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'shutdown signal received, closing HTTP server');
    server.close((err) => {
      if (err !== undefined) {
        logger.error({ err }, 'error while closing HTTP server');
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}
