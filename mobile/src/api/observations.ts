import type { Licence } from '@/lib/licences';

import { type Page, type CountedPage, request, file, upload } from './client';
import type { Species } from './species';
import type { PhotoTag, SoundTag } from './curation';

export type Observation = {
  id: number;
  observer: { id: number; display_name: string; avatar_url: string | null };
  /** OBS-14: true when lat/lng were snapped to an ~11 km cell to protect a sensitive species. */
  obscured: boolean;
  /** VER-02 */
  status: 'needs_id' | 'community' | 'verified';
  /** ADM-01: hidden by a moderator; only its observer and moderators see it. */
  hidden: boolean;
  /** VER-08: the species is unlikely here ("range") or at this time of year ("season"); a verifier has to confirm. */
  unusual: '' | 'range' | 'season';
  /** COM-02 */
  likes: number;
  liked: boolean;
  community_species: Pick<Species, 'id' | 'english_name' | 'scientific_name'> | null;
  /** OBS-04 named site (null when none, or when the location is hidden). */
  site: Site | null;
  species: (Pick<Species, 'id' | 'english_name' | 'scientific_name'> & { thumb_url: string | null }) | null;
  observed_at: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  count: number;
  notes: string;
  features: Features;
  confidence: Confidence | '';
  created_at: string;
  photos: Photo[];
  sounds: Sound[];
};

export type Sound = { id: number; url: string; spectrogram_url: string; duration_s: number; licence: Licence; tags?: SoundTag[] };

/** OBS-08: how sure the submitter is of their own ID. */
export type Confidence = 'certain' | 'likely' | 'guess';

/** OBS-05. Single-choice fields hold a string, multi-choice fields a list. */
export type Features = Record<string, string | string[]>;
export type FeatureField = { key: string; label: string; multi: boolean; options: { value: string; label: string }[] };

export const getFeatureFields = () => request<FeatureField[]>('/features');

export type Photo = {
  id: number;
  url: string;
  thumb_url: string;
  width: number;
  height: number;
  licence: Licence;
  quiz_suitable: boolean;
  /** VER-07: a verifier marked it reference quality. */
  reference: boolean;
  tags: PhotoTag[]; // LIB-08
};

export type NewObservation = {
  species_id: number | null;
  observed_at: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  count: number;
  notes: string;
  features: Features;
  confidence: Confidence | '';
  site_id: number | null;
  /** OBS-09: the offline queue's id, so a retried upload never creates the sighting twice. */
  client_id?: string;
  /** OBS-10: logged during this outing (server id). */
  outing_id?: number;
};

export const createObservation = (token: string, o: NewObservation) =>
  request<Observation>('/observations', { method: 'POST', token, body: JSON.stringify(o) });

export const myObservations = (token: string, offset = 0) =>
  request<CountedPage<Observation>>(`/me/observations?offset=${offset}`, { token });

export const addPhoto = (token: string, observationId: number, fileUri: string, licence: Licence) =>
  upload<Photo>('POST', `/observations/${observationId}/photos`, token, { licence, image: file(fileUri, 'image.jpg', 'image/jpeg') });

export const getObservation = (id: number, token?: string) => request<Observation>(`/observations/${id}`, { token });

export const updateObservation = (token: string, id: number, o: NewObservation) =>
  request<Observation>(`/observations/${id}`, { method: 'PUT', token, body: JSON.stringify(o) });

export const deleteObservation = (token: string, id: number) =>
  request<void>(`/observations/${id}`, { method: 'DELETE', token });

export const deletePhoto = (token: string, observationId: number, photoId: number) =>
  request<void>(`/observations/${observationId}/photos/${photoId}`, { method: 'DELETE', token });

export type Edit = { edited_at: string; changes: Record<string, { from: unknown; to: unknown }> };

export const observationHistory = (token: string, id: number) =>
  request<{ items: Edit[] }>(`/observations/${id}/history`, { token });

export type Identification = {
  id: number;
  user: { id: number; display_name: string; avatar_url: string | null };
  verifier: boolean;
  species: Pick<Species, 'id' | 'english_name' | 'scientific_name'>;
  reason: string;
  created_at: string;
};

export const listIdentifications = (id: number) => request<{ items: Identification[] }>(`/observations/${id}/identifications`);

export const addIdentification = (token: string, id: number, speciesId: number, reason: string) =>
  request<Observation>(`/observations/${id}/identifications`, {
    method: 'POST',
    token,
    body: JSON.stringify({ species_id: speciesId, reason }),
  });

export const withdrawIdentification = (token: string, id: number) =>
  request<Observation>(`/observations/${id}/identifications`, { method: 'DELETE', token });

export type FlagReason = 'wrong_id' | 'captive' | 'poor_quality' | 'inappropriate' | 'sensitive_location';

export const flagObservation = (token: string, id: number, reason: FlagReason) =>
  request<void>(`/observations/${id}/flags`, { method: 'POST', token, body: JSON.stringify({ reason }) });

export const feed = (status: Observation['status'], offset = 0, token?: string) =>
  request<Page<Observation>>(`/observations?status=${status}&not_mine=1&offset=${offset}`, { token });

export const verifyQueue = (token: string, hasPhoto: boolean, offset = 0, unusual = false) =>
  request<Page<Observation>>(`/verify/queue?offset=${offset}${hasPhoto ? '&has_photo=1' : ''}${unusual ? '&unusual=1' : ''}`, { token });

/** The species to show for an observation: the community's answer once there is one. */
export const shownSpecies = (o: Observation) => o.community_species ?? o.species;

/** OBS-03: duration + spectrogram (data URL) of an unsaved recording, for trimming. */
export const previewAudio = (token: string, fileUri: string, mimeType = 'audio/mp4') =>
  upload<{ duration_s: number; max_clip_s: number; spectrogram: string }>('POST', '/audio/preview', token, {
    audio: file(fileUri, 'recording.m4a', mimeType),
  });

export const addSound = (
  token: string,
  observationId: number,
  s: { uri: string; mimeType?: string; start: number; end: number },
  licence: Licence,
) =>
  upload<Sound>('POST', `/observations/${observationId}/sounds`, token, {
    trim_start: s.start.toFixed(3),
    trim_end: s.end.toFixed(3),
    licence,
    audio: file(s.uri, 'recording.m4a', s.mimeType ?? 'audio/mp4'),
  });

export const deleteSound = (token: string, observationId: number, soundId: number) =>
  request<void>(`/observations/${observationId}/sounds/${soundId}`, { method: 'DELETE', token });

export type Site = { id: number; name: string; lat: number; lng: number; distance_m?: number };
export const nearbySites = (lat: number, lng: number) => request<{ items: Site[] }>(`/sites?near=${lat},${lng}`);
export const createSite = (token: string, name: string, lat: number, lng: number) =>
  request<Site>('/sites', { method: 'POST', token, body: JSON.stringify({ name, lat, lng }) });

/** OBS-10 outings. */
export type OutingSummary = {
  id: number;
  started_at: string;
  ended_at: string | null;
  minutes: number;
  distance_m: number;
  route: [number, number][];
  sightings: number;
  species: { id: number; english_name: string; count: number }[];
};
export type OutingRow = { id: number; started_at: string; ended_at: string | null; distance_m: number; sightings: number; species: number };
export const upsertOuting = (
  token: string,
  o: { client_id: string; started_at: string; ended_at?: string; route?: [number, number][] },
) => request<OutingSummary>('/outings', { method: 'POST', token, body: JSON.stringify(o) });
export const getOuting = (token: string, id: number) => request<OutingSummary>(`/outings/${id}`, { token });
export const myOutings = (token: string) => request<{ items: OutingRow[] }>('/me/outings', { token });

/** VER-09 comments. */
export type Comment = {
  id: number;
  parent_id: number | null;
  author: { id: number; display_name: string; avatar_url: string | null };
  body: string;
  deleted: boolean;
  hidden: boolean;
  created_at: string;
  replies: Comment[] | null;
};
export const listComments = (observationId: number, token?: string) =>
  request<{ items: Comment[] }>(`/observations/${observationId}/comments`, { token });
export const addComment = (token: string, observationId: number, body: string, parentId?: number) =>
  request<{ id: number }>(`/observations/${observationId}/comments`, {
    method: 'POST',
    token,
    body: JSON.stringify({ body, parent_id: parentId ?? null }),
  });
export const deleteComment = (token: string, id: number) => request<void>(`/comments/${id}`, { method: 'DELETE', token });
export const reportComment = (token: string, id: number, reason: 'spam' | 'harassment' | 'inappropriate' | 'other') =>
  request<void>(`/comments/${id}/report`, { method: 'POST', token, body: JSON.stringify({ reason }) });
