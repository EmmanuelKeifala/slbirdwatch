// OBS-09 retry rules, kept pure so `npm test` can check them.

type Failure = 'offline' | 'retry' | 'auth' | 'fatal';

/** fetch throws TypeError with no response (no signal, server unreachable); the API client throws errors with a status. */
export function classify(err: unknown): Failure {
  const status = (err as { status?: number } | null)?.status;
  if (typeof status !== 'number') return 'offline';
  if (status === 401) return 'auth';
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  return 'fatal'; // the server said no (bad data, not allowed): retrying won't help
}

/** Wait before the next try: 30 s, 1, 2, 4… minutes, at most an hour. */
export const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
