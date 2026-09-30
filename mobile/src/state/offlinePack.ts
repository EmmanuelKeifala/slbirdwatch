import { Directory, File, Paths } from 'expo-file-system';

import { API_URL, mediaUrl, type Species, type SpeciesDetail } from '@/api';

// LIB-11: Sierra Leone's birds on the phone, for places with no signal. The pack is every species page (text,
// month chart, local names) plus each bird's main photo (~18 MB in all) and, if chosen, a call for each (~90 MB);
// the photo and sound galleries stay online. Kept in <documents>/pack.

export type PackInfo = { version: string; savedAt: string; species: number; calls: boolean; bytes: number };

const dir = () => new Directory(Paths.document, 'pack');
const manifest = () => new File(dir(), 'species.json');
const infoFile = () => new File(dir(), 'info.json');

let memo: SpeciesDetail[] | null = null;

function all(): SpeciesDetail[] {
  if (memo) return memo;
  try {
    const f = manifest();
    memo = f.exists ? (JSON.parse(f.textSync()) as SpeciesDetail[]) : [];
  } catch {
    memo = [];
  }
  return memo;
}

export function packInfo(): PackInfo | null {
  try {
    const f = infoFile();
    return f.exists ? (JSON.parse(f.textSync()) as PackInfo) : null;
  } catch {
    return null;
  }
}

/** The saved page for a bird, or undefined if it isn't in the pack. */
export const packSpecies = (id: number) => all().find((s) => s.id === id);

/** Offline library: every word typed must start a word of a name (common, scientific or local). */
export function packSearch(q: string): Species[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return all().filter((s) => {
    const names = `${s.english_name} ${s.scientific_name} ${s.local_names.map((n) => n.name).join(' ')}`.toLowerCase().split(/[\s-]+/);
    return words.every((w) => names.some((n) => n.startsWith(w)));
  });
}

export function deletePack() {
  memo = null;
  const d = dir();
  if (d.exists) d.delete();
}

/**
 * Download the pack. Runs 4 files at a time; `onProgress(done, total)` after each. A new download replaces the
 * old one only once it has fully arrived, so a dropped connection never leaves you with half a pack.
 */
export async function downloadPack(calls: boolean, onProgress: (done: number, total: number) => void) {
  const res = await fetch(`${API_URL}/packs/sierra-leone`);
  if (!res.ok) throw new Error(`Couldn’t get the pack (HTTP ${res.status})`);
  const pack = (await res.json()) as { version: string; species: SpeciesDetail[] };

  const tmp = new Directory(Paths.document, 'pack-new');
  if (tmp.exists) tmp.delete();
  tmp.create();
  const media = new Directory(tmp, 'media');
  media.create();

  type Job = { url: string; name: string; set: (uri: string) => void };
  const jobs: Job[] = [];
  const species = pack.species.map((sp) => {
    const s: SpeciesDetail = { ...sp, gallery: [], sounds: [] }; // galleries stay online
    if (sp.image) {
      const img = { ...sp.image };
      s.image = img;
      jobs.push({ url: sp.image.thumb_url, name: `${sp.id}.jpg`, set: (u) => (img.url = img.thumb_url = u) });
    }
    // the bird's main call, else its first song or call from the Xeno-canto gallery; no spectrogram (it's as
    // big as the call itself), so the player just shows none offline
    const g = sp.sounds.find((x) => x.kind === 'song' || x.kind === 'call');
    const main = sp.sound ?? (g && { ...g, type: g.type || g.kind });
    if (calls && main) {
      const snd = { ...main, spectrogram_url: '' };
      s.sound = snd;
      jobs.push({ url: main.url, name: `${sp.id}.m4a`, set: (u) => (snd.url = u) });
    } else {
      s.sound = null;
    }
    return s;
  });

  let done = 0;
  let bytes = 0;
  onProgress(0, jobs.length);
  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      try {
        const f = await File.downloadFileAsync(mediaUrl(job.url), new File(media, job.name), { idempotent: true });
        job.set(f.uri);
        bytes += f.size ?? 0;
      } catch {
        job.set(''); // one missing photo or call shouldn't sink the pack; the page just shows none
      }
      onProgress(++done, done + jobs.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  for (const s of species) {
    if (s.image && !s.image.url) s.image = null;
    if (s.sound && !s.sound.url) s.sound = null;
  }

  const text = JSON.stringify(species);
  new File(tmp, 'species.json').write(text);
  const info: PackInfo = { version: pack.version, savedAt: new Date().toISOString(), species: species.length, calls, bytes: bytes + text.length };
  new File(tmp, 'info.json').write(JSON.stringify(info));

  // swap in the new pack; downloaded file paths point into pack-new, so rewrite them to pack
  const slash = (u: string) => u.replace(/\/?$/, '/');
  const from = slash(tmp.uri);
  deletePack();
  tmp.rename('pack');
  manifest().write(text.split(from).join(slash(dir().uri)));
  memo = null;
  return info;
}
