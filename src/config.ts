import 'dotenv/config';

export type NodeEnv = 'development' | 'production' | 'test';

export interface Config {
  nodeEnv: NodeEnv;
  port: number;
  logLevel: string;
  databaseUrl: string;
  workerConcurrency: number;
  pollIntervalMs: number;
  jobMaxAttemptsDefault: number;
  retryBaseDelaySeconds: number;
  retryMaxDelaySeconds: number;
  shutdownDrainTimeoutMs: number;
  schedulerTickMs: number;
  enqueueRateLimitPerMin: number;
  /** Optional token gating state-changing routes. Unset = fully open (local dev default). */
  dashboardToken: string | undefined;
}

function parseNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'production' || value === 'test' || value === 'development') return value;
  return 'development';
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseStringEnv(value: string | undefined, fallback: string): string {
  if (value === undefined || value.trim() === '') return fallback;
  return value;
}

function parseOptionalStringEnv(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  return value;
}

function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    nodeEnv: parseNodeEnv(env['NODE_ENV']),
    port: parseIntEnv(env['PORT'], 3000),
    logLevel: parseStringEnv(env['LOG_LEVEL'], 'info'),
    databaseUrl: parseStringEnv(
      env['DATABASE_URL'],
      'postgres://queueforge:queueforge@localhost:5432/queueforge',
    ),
    workerConcurrency: parseIntEnv(env['WORKER_CONCURRENCY'], 4),
    pollIntervalMs: parseIntEnv(env['POLL_INTERVAL_MS'], 5000),
    jobMaxAttemptsDefault: parseIntEnv(env['JOB_MAX_ATTEMPTS_DEFAULT'], 5),
    retryBaseDelaySeconds: parseIntEnv(env['RETRY_BASE_DELAY_SECONDS'], 10),
    retryMaxDelaySeconds: parseIntEnv(env['RETRY_MAX_DELAY_SECONDS'], 3600),
    shutdownDrainTimeoutMs: parseIntEnv(env['SHUTDOWN_DRAIN_TIMEOUT_MS'], 25000),
    schedulerTickMs: parseIntEnv(env['SCHEDULER_TICK_MS'], 30000),
    enqueueRateLimitPerMin: parseIntEnv(env['ENQUEUE_RATE_LIMIT_PER_MIN'], 60),
    dashboardToken: parseOptionalStringEnv(env['DASHBOARD_TOKEN']),
  };
}

/** Read once at startup — never read `process.env` scattered through the codebase. */
export const config: Config = loadConfig();
