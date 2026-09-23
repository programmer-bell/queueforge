import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../logger.js';

// Phase 0 placeholder: applies pending numbered *.sql migrations in order.
// Phase 1 adds the real `jobs` / `job_events` / `schedules` DDL files; until
// then this exits cleanly so `npm run migrate`, docker-compose, and CI keep working.
async function main(): Promise<void> {
  const dir = join(process.cwd(), 'src', 'db', 'migrations');
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    logger.info({ dir }, 'no migrations directory yet, nothing to apply');
    return;
  }
  if (files.length === 0) {
    logger.info('no migrations to apply');
    return;
  }
  logger.info({ files }, 'migration runner lands in Phase 1; pending files listed, none applied');
}

await main();
