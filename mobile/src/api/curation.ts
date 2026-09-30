import { request } from './client';
import type { LocalName } from './species';

/** ADM-02 taxonomy admin: local names, sensitive species, merges and splits. */
export const addLocalName = (token: string, speciesId: number, name: string, language: string) =>
  request<{ items: LocalName[] }>(`/admin/species/${speciesId}/names`, { method: 'POST', token, body: JSON.stringify({ name, language }) });
export const deleteLocalName = (token: string, speciesId: number, name: string) =>
  request<{ items: LocalName[] }>(`/admin/species/${speciesId}/names?name=${encodeURIComponent(name)}`, { method: 'DELETE', token });

export type SensitiveSpecies = { id: number; english_name: string; scientific_name: string; km: number; local: boolean };
export const listSensitive = (token: string) => request<{ items: SensitiveSpecies[] }>('/admin/sensitive', { token });
export const setSensitive = (token: string, speciesId: number, sensitive: boolean, km: number) =>
  request<void>(`/admin/species/${speciesId}/sensitive`, { method: 'PUT', token, body: JSON.stringify({ sensitive, km }) });
export const changeTaxonomy = (token: string, kind: 'merge' | 'split', from: number, into: number[], note: string) =>
  request<void>(`/admin/species/${kind}`, { method: 'POST', token, body: JSON.stringify({ from, into, note }) });

/** LIB-08: what a photo shows. The sighting's observer or a verifier; gallery photos: verifiers. */
export type PhotoTag = 'male' | 'female' | 'juvenile' | 'adult' | 'breeding' | 'non-breeding' | 'in-flight';
/** LIB-09: what a community recording holds (ref "sound:<id>"). */
export type SoundTag = 'song' | 'call' | 'alarm' | 'flight';
export const setPhotoTags = (token: string, ref: string, tags: (PhotoTag | SoundTag)[]) =>
  request<{ tags: (PhotoTag | SoundTag)[] }>('/photos/tags', { method: 'PUT', token, body: JSON.stringify({ media_ref: ref, tags }) });

export const putTip = (token: string, speciesId: number, text: string, otherId: number | null) =>
  request<{ id: number }>(`/species/${speciesId}/tips`, { method: 'PUT', token, body: JSON.stringify({ text, other_species_id: otherId }) });
export const deleteTip = (token: string, id: number) => request<void>(`/tips/${id}`, { method: 'DELETE', token });

/** LRN-03 (verifiers): pin a labelled field mark on a reference photo ("gallery:<id>" or "photo:<id>"). */
export type PhotoMark = { id: number; x: number; y: number; label: string };
export const addPhotoMark = (token: string, ref: string, x: number, y: number, label: string) =>
  request<PhotoMark>('/photos/marks', { method: 'POST', token, body: JSON.stringify({ media_ref: ref, x, y, label }) });
export const deletePhotoMark = (token: string, id: number) => request<void>(`/photos/marks/${id}`, { method: 'DELETE', token });

/** LRN-08 (verifiers): set a bird's memory phrase; empty removes it. */
export const putMnemonic = (token: string, speciesId: number, text: string) =>
  request<{ mnemonic: string }>(`/species/${speciesId}/mnemonic`, { method: 'PUT', token, body: JSON.stringify({ text }) });

/** VER-07: mark a photo ("photo:<id>" from a verified sighting, or "gallery:<id>") as reference quality. */
export const setReference = (token: string, ref: string, reference: boolean) =>
  request<void>('/verify/reference', { method: 'PUT', token, body: JSON.stringify({ media_ref: ref, reference }) });

/** QZ-12 (verifiers): keep a photo out of quizzes. ref = QuizQuestion.media_ref or `photo:<id>`. */
export const setQuizSuitable = (token: string, ref: string, suitable: boolean) =>
  request<void>('/quiz/suitability', { method: 'PUT', token, body: JSON.stringify({ media_ref: ref, suitable }) });
