/** Job execution handlers. Types are arbitrary strings; the registry maps a
 * type to its implementation. Unknown types succeed with a log line — there
 * is no real work to perform, and ad-hoc API submissions must not spuriously
 * land in the DLQ. Call `registerHandler` to add real workloads. */

export type JobHandler = (payload: unknown) => Promise<void> | void;

const registry = new Map<string, JobHandler>();

export function registerHandler(type: string, handler: JobHandler): void {
  registry.set(type, handler);
}

export function getHandler(type: string): JobHandler | undefined {
  return registry.get(type);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slowMs(payload: unknown): number {
  if (typeof payload === 'object' && payload !== null && 'ms' in payload) {
    const ms = (payload as { ms: unknown }).ms;
    if (typeof ms === 'number' && Number.isFinite(ms)) {
      return Math.min(Math.max(ms, 0), 30000);
    }
  }
  return 2000;
}

// Built-in demo handlers (used by the dashboard test-job form + shutdown tests).
registerHandler('demo.echo', () => {});
registerHandler('demo.fail', () => {
  throw new Error('demo.fail always fails');
});
registerHandler('demo.slow', async (payload) => {
  await sleep(slowMs(payload));
});
