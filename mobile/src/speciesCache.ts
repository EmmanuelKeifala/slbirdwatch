import { File, Paths } from 'expo-file-system';

import { listSpecies } from '@/api';

// OBS-09: Sierra Leone's birds kept on the phone, so the species picker works with no signal.
type Cached = { id: number; english_name: string; scientific_name: string };
const file = () => new File(Paths.document, 'species-sl.json');
const WEEK = 7 * 24 * 3600 * 1000;

let memo: Cached[] | null = null;

function cached(): Cached[] {
  if (memo) return memo;
  try {
    const f = file();
    memo = f.exists ? (JSON.parse(f.textSync()) as Cached[]) : [];
  } catch {
    memo = [];
  }
  return memo;
}

/** Refresh the copy once a week (the library lists Sierra Leone birds first, marked `local`). */
export async function refreshSpeciesCache() {
  const f = file();
  if (f.exists && cached().length && Date.now() - (f.modificationTime ?? 0) < WEEK) return;
  const all: Cached[] = [];
  for (let offset: number | null = 0; offset !== null; ) {
    const page = await listSpecies({ offset });
    const local = page.items.filter((s) => s.local);
    all.push(...local.map(({ id, english_name, scientific_name }) => ({ id, english_name, scientific_name })));
    offset = local.length === page.items.length ? page.next_offset : null; // stop at the first non-local bird
  }
  if (all.length) {
    f.write(JSON.stringify(all));
    memo = all;
  }
}

/** Offline search: every word typed must start a word of the common or scientific name. */
export function searchCached(q: string, limit = 8): Cached[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return cached()
    .filter((s) => {
      const names = `${s.english_name} ${s.scientific_name}`.toLowerCase().split(/[\s-]+/);
      return words.every((w) => names.some((n) => n.startsWith(w)));
    })
    .slice(0, limit);
}
