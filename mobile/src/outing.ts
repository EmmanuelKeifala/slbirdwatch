import { File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import { useSyncExternalStore } from 'react';

import { upsertOuting } from '@/api';
import { addFix, type LatLng } from '@/outingMath';

// OBS-10: the outing in progress lives on the phone (it has to work with no signal). GPS runs only while an
// outing is active and the app is open (NFR-05: no background tracking). Ended outings wait in a small queue
// until they reach the server; sightings logged on the outing carry its id and link up when they upload.

export type Outing = { clientId: string; startedAt: string; endedAt?: string; route: LatLng[]; userId: number; logged?: number };

type State = { active: Outing | null; pending: Outing[]; serverIds: Record<string, number> };

const file = () => new File(Paths.document, 'outing.json');
let state: State = load();
const listeners = new Set<() => void>();
let watch: Location.LocationSubscription | null = null;

function load(): State {
  try {
    const f = file();
    if (f.exists) return { active: null, pending: [], serverIds: {}, ...JSON.parse(f.textSync()) };
  } catch {
    // unreadable: start fresh
  }
  return { active: null, pending: [], serverIds: {} };
}

function save(next: State) {
  state = next;
  try {
    file().write(JSON.stringify(next));
  } catch {
    // storage full: the outing still works while the app is open
  }
  listeners.forEach((l) => l());
}

export function useOutingState(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const activeOuting = () => state.active;

/** Start recording the route (asks for location permission). Returns an error message, or null. */
export async function startOuting(userId: number): Promise<string | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return 'Location permission is needed to record your route.';
  const clientId = `out-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  save({ ...state, active: { clientId, startedAt: new Date().toISOString(), route: [], userId } });
  await resumeTracking();
  return null;
}

/** (Re)start GPS for the active outing, e.g. after the app was closed mid-walk. */
export async function resumeTracking() {
  if (!state.active || watch) return;
  try {
    watch = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 15, timeInterval: 10_000 },
      (pos) => {
        if (!state.active) return;
        const route = addFix(state.active.route, [pos.coords.latitude, pos.coords.longitude], pos.coords.accuracy);
        if (route !== state.active.route) save({ ...state, active: { ...state.active, route } });
      },
    );
  } catch {
    watch = null; // no permission any more: the outing continues without a route
  }
}

export function stopTracking() {
  watch?.remove();
  watch = null;
}

/** A sighting was saved on the active outing (for the live count). */
export function noteSighting() {
  if (state.active) save({ ...state, active: { ...state.active, logged: (state.active.logged ?? 0) + 1 } });
}

/** End the active outing; it's queued for upload. */
export function endOuting(): Outing | null {
  const done = state.active ? { ...state.active, endedAt: new Date().toISOString() } : null;
  stopTracking();
  save({ ...state, active: null, pending: done ? [...state.pending, done] : state.pending });
  return done;
}

/** Throw away the active outing without saving it (sightings already logged stay, just unlinked). */
export function cancelOuting() {
  stopTracking();
  save({ ...state, active: null });
}

/** The server's id for an outing, creating it first if needed (used by the sighting upload queue). */
export async function outingServerId(token: string, clientId: string): Promise<number> {
  const known = state.serverIds[clientId];
  if (known) return known;
  const o = state.active?.clientId === clientId ? state.active : state.pending.find((p) => p.clientId === clientId);
  if (!o) throw Object.assign(new Error('That outing was deleted from this phone.'), { status: 400 });
  const res = await upsertOuting(token, { client_id: o.clientId, started_at: o.startedAt });
  save({ ...state, serverIds: { ...state.serverIds, [clientId]: res.id } });
  return res.id;
}

/** Upload ended outings (with their routes). Returns the server id of the last one sent. */
export async function syncOutings(token: string, userId: number): Promise<number | null> {
  let last: number | null = null;
  for (const o of state.pending.filter((p) => p.userId === userId)) {
    try {
      const res = await upsertOuting(token, { client_id: o.clientId, started_at: o.startedAt, ended_at: o.endedAt, route: o.route });
      last = res.id;
      save({ ...state, pending: state.pending.filter((p) => p.clientId !== o.clientId), serverIds: { ...state.serverIds, [o.clientId]: res.id } });
    } catch {
      break; // offline: try again later
    }
  }
  return last;
}
