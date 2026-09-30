// OBS-03 trim handles: keep at least MIN_S and at most MAX_S seconds, inside the recording.
const MIN_S = 0.5;
const MAX_S = 60;

export type Trim = { start: number; end: number };

/** Move one handle to `t` seconds and return a valid selection. */
export function moveHandle(trim: Trim, handle: 'start' | 'end', t: number, duration: number): Trim {
  if (handle === 'start') {
    const start = Math.min(Math.max(0, t, trim.end - MAX_S), trim.end - MIN_S);
    return { start: Math.max(0, start), end: trim.end };
  }
  const end = Math.max(Math.min(duration, t, trim.start + MAX_S), trim.start + MIN_S);
  return { start: trim.start, end: Math.min(duration, end) };
}

/** Default selection for a new recording: the first MAX_S seconds. */
export const initialTrim = (duration: number): Trim => ({ start: 0, end: Math.min(duration, MAX_S) });

export const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
