import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { addPhoto, addSound, createObservation, type NewObservation } from '@/api';
import type { Licence } from '@/lib/licences';
import { backoffMs, classify } from '@/lib/outboxRules';
import { outingServerId } from '@/state/outing';

// OBS-09: every new sighting is saved here first, with copies of its photos and sounds, then uploaded.
// Works with no signal; retries with back-off; a sighting already created on the server is never created
// twice (client_id), and each photo/sound leaves the queue as soon as it's uploaded.

type QueuedSound = { uri: string; mimeType?: string; start: number; end: number };

export type OutboxItem = {
  id: string; // also the client_id sent to the server
  userId: number;
  createdAt: string;
  label: string; // species name, for the list
  input: NewObservation;
  photos: string[];
  sounds: QueuedSound[];
  licence: Licence;
  outingClientId?: string; // OBS-10: logged during this outing
  serverId?: number;
  attempts: number;
  nextTry: number; // epoch ms
  state: 'waiting' | 'uploading' | 'offline' | 'retry' | 'failed' | 'signin';
  error?: string;
};

const dir = () => new Directory(Paths.document, 'outbox');
const index = () => new File(Paths.document, 'outbox.json');

let items: OutboxItem[] = load();
const listeners = new Set<() => void>();

function load(): OutboxItem[] {
  try {
    const f = index();
    return f.exists ? (JSON.parse(f.textSync()) as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

function save(next: OutboxItem[]) {
  items = next;
  try {
    index().write(JSON.stringify(next));
  } catch {
    // Storage full: the in-memory queue still uploads while the app is open.
  }
  listeners.forEach((l) => l());
}

function update(id: string, patch: Partial<OutboxItem>) {
  save(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
}

/** The queue for this person, oldest first; re-renders when it changes. */
export function useOutbox(userId: number | undefined): OutboxItem[] {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
  );
  return all.filter((it) => it.userId === userId);
}

/** Save a new sighting on the phone (files are copied in, so they survive the cache being cleared), then try to upload. */
export async function enqueue(
  userId: number,
  label: string,
  input: NewObservation,
  photos: string[],
  sounds: QueuedSound[],
  licence: Licence,
  outingClientId?: string,
): Promise<void> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const folder = new Directory(dir(), id);
  folder.create({ intermediates: true, idempotent: true });
  const keep = async (uri: string, name: string) => {
    const dest = new File(folder, name);
    await new File(uri).copy(dest);
    return dest.uri;
  };
  const copiedPhotos = await Promise.all(photos.map((p, i) => keep(p, `photo-${i}.jpg`)));
  const copiedSounds = await Promise.all(sounds.map(async (s, i) => ({ ...s, uri: await keep(s.uri, `sound-${i}.m4a`) })));
  save([
    ...items,
    {
      id,
      userId,
      createdAt: new Date().toISOString(),
      label,
      input,
      photos: copiedPhotos,
      sounds: copiedSounds,
      licence,
      outingClientId,
      attempts: 0,
      nextTry: 0,
      state: 'waiting',
    },
  ]);
}

/** Drop a queued sighting and its files (never uploaded, or given up on). */
export function discard(id: string) {
  try {
    new Directory(dir(), id).delete();
  } catch {
    // already gone
  }
  save(items.filter((it) => it.id !== id));
}

export function retryNow(id: string) {
  update(id, { nextTry: 0, state: 'waiting', error: undefined });
}

let running: Promise<void> | null = null;

/** Upload everything that's due for this person. Safe to call often: one run at a time. */
export function syncOutbox(token: string, userId: number): Promise<void> {
  running ??= (async () => {
    try {
      for (const it of items.filter((x) => x.userId === userId && x.state !== 'failed' && x.nextTry <= Date.now())) {
        if (!(await syncOne(token, it))) break; // offline or signed out: the rest would fail the same way
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Returns false when the rest of the queue should wait (no connection, or signed out). */
async function syncOne(token: string, start: OutboxItem): Promise<boolean> {
  let it = start;
  update(it.id, { state: 'uploading' });
  try {
    if (!it.serverId) {
      const outing = it.outingClientId ? await outingServerId(token, it.outingClientId) : undefined;
      const obs = await createObservation(token, { ...it.input, client_id: it.id, outing_id: outing });
      update(it.id, { serverId: obs.id });
      it = { ...it, serverId: obs.id };
    }
    while (it.photos.length) {
      // OBS-15: a photo the server already has (same picture) is skipped, not a reason to fail the sighting.
      await addPhoto(token, it.serverId!, it.photos[0], it.licence).catch((e) => {
        if ((e as { status?: number }).status !== 409) throw e;
      });
      it = { ...it, photos: it.photos.slice(1) };
      update(it.id, { photos: it.photos });
    }
    while (it.sounds.length) {
      await addSound(token, it.serverId!, it.sounds[0], it.licence);
      it = { ...it, sounds: it.sounds.slice(1) };
      update(it.id, { sounds: it.sounds });
    }
    discard(it.id);
    return true;
  } catch (e) {
    const kind = classify(e);
    const attempts = it.attempts + 1;
    const message = e instanceof Error ? e.message : String(e);
    if (kind === 'fatal') update(it.id, { state: 'failed', attempts, error: message });
    else if (kind === 'auth') update(it.id, { state: 'signin', attempts, error: 'Sign in again to upload' });
    else if (kind === 'offline') update(it.id, { state: 'offline', nextTry: Date.now() + 30_000 }); // no signal: just check again soon
    else update(it.id, { state: 'retry', attempts, nextTry: Date.now() + backoffMs(attempts), error: message });
    return kind === 'retry' || kind === 'fatal';
  }
}
