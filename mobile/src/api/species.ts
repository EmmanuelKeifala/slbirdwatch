import { type Page, request } from './client';
import type { PhotoTag, PhotoMark } from './curation';
import type { Photo } from './observations';

/** Seeded open-licence photo (LIB-12); always show `credit` and `licence` with it. */
export type SpeciesImage = {
  url: string;
  thumb_url: string;
  credit: string;
  licence: string;
  licence_url: string;
  source_url: string;
};

export type Species = {
  id: number;
  english_name: string;
  scientific_name: string;
  family_sci: string;
  family_en: string;
  /** Recorded in Sierra Leone. */
  local?: boolean;
  image: SpeciesImage | null;
};

/** LIB-03 browse filters (habitat/size/colour values come from GET /features). */
export type BrowseFilters = { family?: string; habitat?: string; size?: string; colour?: string; near?: { lat: number; lng: number } };

export async function listSpecies(params: { q?: string; offset?: number } & BrowseFilters, signal?: AbortSignal) {
  const qs = new URLSearchParams({ limit: '50', offset: String(params.offset ?? 0) });
  if (params.q) qs.set('q', params.q);
  for (const k of ['family', 'habitat', 'size', 'colour'] as const) if (params[k]) qs.set(k, params[k]!);
  if (params.near) qs.set('near', `${params.near.lat},${params.near.lng}`);
  const page = await request<Page<Species>>(`/species?${qs}`, { signal });
  for (const s of page.items) knownSpecies.set(s.id, s);
  return page;
}

// Birds already fetched this session: a bird page opens with its name and photo at once, and instantly on a revisit.
export const knownSpecies = new Map<number, Species>();
const speciesDetails = new Map<number, SpeciesDetail>();
export const cachedSpecies = (id: number) => speciesDetails.get(id);

/** OBS-06 picker result: `recent` (you logged it), `likely` (seen in Sierra Leone around that month), `region`, or ''. */
export type PickHint = 'recent' | 'likely' | 'region' | '';
export type PickItem = Species & { hint: PickHint };

export const pickSpecies = (q: string, month: number, token?: string, signal?: AbortSignal) =>
  request<{ items: PickItem[] }>(`/species/pick?q=${encodeURIComponent(q)}&month=${month}`, { token, signal });

/** Seeded Xeno-canto recording (LIB-12b); always show credit + licence. */
export type SpeciesSound = {
  url: string;
  spectrogram_url: string;
  duration_s: number;
  type: string;
  credit: string;
  licence: string;
  licence_url: string;
  source_url: string;
};

export type SpeciesDetail = Species & {
  sound: SpeciesSound | null;
  order_name: string;
  authority: string;
  breeding_range: string;
  nonbreeding_range: string;
  extinct: boolean;
  /** Wikipedia text (CC BY-SA): always shown with a link to source_url. Sierra Leone species only. */
  details: {
    sections: TextSection[];
    highlights: TextSection[];
    length: string;
    iucn: '' | 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'DD' | 'EW' | 'EX';
    source_url: string;
    licence: string;
  } | null;
  /** LIB-08 reference photos (iNaturalist), credited; male/female/juvenile first. */
  gallery: GalleryPhoto[];
  /** LIB-09 recordings (Xeno-canto): songs, calls, alarms, flight calls. */
  sounds: SoundRecording[];
  /** ADM-03: other people see its sightings blurred to about `obscure_km`. */
  sensitive: boolean;
  obscure_km: number;
  /** ADM-02: names in local languages (kri Krio, men Mende, tem Temne, …). */
  local_names: LocalName[];
  /** LRN-08: a memory phrase for its song or call. */
  mnemonic: string;
  /** ADM-02: retired by a taxonomy update and now part of this species. */
  merged_into: { id: number; english_name: string; scientific_name: string } | null;
  /** ADM-02: split into these species. */
  split_into: { id: number; english_name: string; scientific_name: string }[];
  /** GBIF records in Sierra Leone, per month Jan..Dec. */
  region: { records: number; months: number[]; gbif_key: number | null } | null;
};
export type TextSection = { title: string; text: string };
export type LocalName = { name: string; language: string };

/** LIB-07 lookalikes and LRN-01 side-by-side comparison. */
export type SimilarSpecies = {
  id: number;
  english_name: string;
  scientific_name: string;
  thumb_url: string | null;
  local: boolean;
  reason: 'confused' | 'genus' | 'family';
};
export const similarSpecies = (id: number) => request<{ items: SimilarSpecies[] }>(`/species/${id}/similar`);
/** LIB-05: community sightings as grid squares (centre, side in degrees, count); never exact points. */
export type MapSquare = { lat: number; lng: number; cell: number; n: number };
export const sightingsMap = (id: number, token?: string) =>
  request<{ items: MapSquare[]; months: number[] }>(`/species/${id}/sightings-map`, { token }); // months: LIB-06, Jan..Dec // signed in: leaves out blocked people
export type FieldMark = { key: string; label: string; count: number; unique: boolean };
export type CompareItem = {
  id: number;
  english_name: string;
  scientific_name: string;
  family_en: string;
  image: string | null;
  variants: GalleryPhoto[];
  sound: SoundRecording | null;
  length: string;
  months: number[] | null;
  sexes: string;
  voice: string;
  marks: FieldMark[];
  sightings: number;
};
export const compareSpecies = (ids: number[]) => request<{ items: CompareItem[] }>(`/compare?ids=${ids.join(',')}`);

export type SoundRecording = {
  url: string;
  spectrogram_url: string;
  duration_s: number;
  kind: 'song' | 'call' | 'alarm' | 'flight';
  type: string;
  sex: string;
  country: string;
  month: number | null;
  season: 'rainy' | 'dry' | '';
  credit: string;
  licence: string;
  licence_url: string;
  source_url: string;
};
export type GalleryPhoto = {
  id: number;
  reference: boolean; // VER-07
  /** LRN-03: labelled field marks on reference photos; x, y are fractions of the photo. */
  marks?: PhotoMark[];
  tags: PhotoTag[]; // LIB-08
  url: string;
  thumb_url: string;
  width: number;
  height: number;
  variant: 'male' | 'female' | 'juvenile' | 'adult' | '';
  month: number | null;
  credit: string;
  licence: string;
  licence_url: string;
  source_url: string;
};

export async function getSpecies(id: number) {
  const d = await request<SpeciesDetail>(`/species/${id}`);
  speciesDetails.set(id, d);
  return d;
}

/** VER-08: would this species be unusual here, on this date? */
export const speciesLikely = (id: number, lat: number, lng: number, date: Date) =>
  request<{ unusual: '' | 'range' | 'season' }>(`/species/${id}/likely?lat=${lat}&lng=${lng}&date=${encodeURIComponent(date.toISOString())}`);

/** LIB-10: expert ID tips; `other` is the lookalike for a "how to tell them apart" tip, null for a general one. */
export type IdTip = { id: number; other: { id: number; english_name: string; scientific_name: string } | null; text: string; author: string; updated_at: string };
export const speciesTips = (id: number) => request<{ items: IdTip[] }>(`/species/${id}/tips`);

export type CommunityPhoto = Photo & { observation_id: number; credit: string };

export const speciesPhotos = (id: number, offset = 0) => request<Page<CommunityPhoto>>(`/species/${id}/photos?offset=${offset}`);

export type Family = { family_sci: string; family_en: string; species: number };
export const listFamilies = () => request<{ items: Family[] }>('/families');

export const familiesOf = (ids: string[]) =>
  request<Record<string, { family: string; name: string }>>(`/species/families-of?ids=${ids.join(',')}`);

/** LIB-13: birds recorded around a point (GBIF + trusted community sightings), with how common each is there. */
export type AreaBird = Species & { gbif: number; community: number; last_seen: string | null; rarity: 'common' | 'uncommon' | 'rare' };
export const areaChecklist = (lat: number, lng: number, km: number, token?: string) =>
  request<{ items: AreaBird[]; km: number; gbif_ok: boolean }>(`/area/checklist?lat=${lat}&lng=${lng}&km=${km}`, { token });
