import Constants from 'expo-constants';

import type { Licence } from '@/licences';
import type { QuizStats } from '@/stats';

// EXPO_PUBLIC_API_URL wins; in dev, fall back to the machine running Metro, port 8080.
const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? `http://${devHost ?? 'localhost'}:8080`;

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

export type Page<T> = { items: T[]; next_offset: number | null };
export type CountedPage<T> = Page<T> & { total: number };

/** LIB-03 browse filters (habitat/size/colour values come from GET /features). */
export type BrowseFilters = { family?: string; habitat?: string; size?: string; colour?: string; near?: { lat: number; lng: number } };

export async function listSpecies(params: { q?: string; offset?: number } & BrowseFilters, signal?: AbortSignal) {
  const qs = new URLSearchParams({ limit: '50', offset: String(params.offset ?? 0) });
  if (params.q) qs.set('q', params.q);
  for (const k of ['family', 'habitat', 'size', 'colour'] as const) if (params[k]) qs.set(k, params[k]!);
  if (params.near) qs.set('near', `${params.near.lat},${params.near.lng}`);
  const res = await fetch(`${API_URL}/species?${qs}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Page<Species>;
}

export type Role = 'member' | 'trusted' | 'verifier' | 'moderator' | 'admin';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';
export type User = {
  id: number;
  email: string;
  display_name: string;
  role: Role;
  created_at: string;
  avatar_url: string | null;
  home_area: string;
  experience_level: ExperienceLevel | '';
  bio: string;
  default_licence: Licence;
  hide_locations: boolean;
  private_profile: boolean;
  guidelines_accepted: boolean;
  /** NTF-04: in-app notification categories. */
  notify_ids: boolean;
  notify_status: boolean;
  notify_comments: boolean;
  notify_reminders: boolean; // NTF-02
  hide_from_leaderboards: boolean; // GAM-05
  /** ACC-02b: false for accounts that only sign in with Google (deleting them asks for a typed confirmation). */
  has_password: boolean;
  /** ADM-01: a moderator's warning from the last 30 days (GET /me only). */
  warning?: { note: string; at: string };
};

/** Media URLs are API-relative in dev ("/media/...") and absolute on a CDN. */
export const mediaUrl = (u: string) => (u.startsWith('/') ? API_URL + u : u);
export type Session = { token: string; user: User };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

/** OBS-06 picker result: `recent` (you logged it), `likely` (seen in Sierra Leone around that month), `region`, or ''. */
export type PickHint = 'recent' | 'likely' | 'region' | '';
export type PickItem = Species & { hint: PickHint };

export const pickSpecies = (q: string, month: number, token?: string, signal?: AbortSignal) =>
  request<{ items: PickItem[] }>(`/species/pick?q=${encodeURIComponent(q)}&month=${month}`, { token, signal });

export const signUp =(email: string, password: string, display_name: string) =>
  request<Session>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, display_name }) });

export const signIn = (email: string, password: string) =>
  request<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });

/** ACC-02b: exchange a Google ID token (from native Google sign-in) for our session. */
export const signInWithGoogle = (idToken: string) =>
  request<Session>('/auth/google', { method: 'POST', body: JSON.stringify({ id_token: idToken }) });

export const signOut = (token: string) => request<void>('/auth/logout', { method: 'POST', token });

export const me = (token: string) => request<User>('/me', { token });

/** NTF-01: in-app notifications. */
export type AppNotification = {
  id: number;
  kind: 'identification' | 'status' | 'comment' | 'reply' | 'rare';
  observation_id: number;
  actor: { id: number; display_name: string; avatar_url: string | null } | null;
  species: { id: number; english_name: string; scientific_name: string } | null;
  status: '' | 'community' | 'verified';
  read: boolean;
  created_at: string;
};
export const myNotifications = (token: string, offset = 0) =>
  request<{ items: AppNotification[]; unread: number; next_offset: number | null }>(`/me/notifications?offset=${offset}`, { token });
export const deleteNotification = (token: string, id: number) => request<void>(`/me/notifications/${id}`, { method: 'DELETE', token });
export const clearNotifications = (token: string) => request<void>('/me/notifications', { method: 'DELETE', token });
export const markNotificationsRead = (token: string, ids: number[] = []) =>
  request<void>('/me/notifications/read', { method: 'POST', token, body: JSON.stringify({ ids }) });

/** NTF-01 push: this phone's Expo push token. */
export const savePushToken = (token: string, pushToken: string, platform: string, device: string) =>
  request<void>('/me/push-token', { method: 'POST', token, body: JSON.stringify({ token: pushToken, platform, device }) });
export type Device = { token: string; platform: string; name: string; added_at: string; last_seen_at: string };
export const myDevices = (token: string) => request<{ items: Device[] }>('/me/devices', { token });
export const deletePushToken = (token: string, pushToken: string) =>
  request<void>(`/me/push-token?token=${encodeURIComponent(pushToken)}`, { method: 'DELETE', token });

/** ACC-04: quiz progress kept with the account. */
export const getQuizStats = (token: string) => request<QuizStats>('/me/quiz-stats', { token });
export const addQuizStats = (token: string, change: QuizStats) =>
  request<QuizStats>('/me/quiz-stats', { method: 'POST', token, body: JSON.stringify(change) });

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

/** VER-06: IDs on others' sightings that ended up verified. */
export type Reputation = { confirmed: number; wrong: number; accuracy: number };
/** GAM-02: XP worked out from verified activity, capped per day (GAM-08). */
export type XP = {
  xp: number;
  level: number;
  level_name: string;
  level_at: number;
  next_at: number | null;
  counts: Record<string, number>;
  today: Record<string, number>;
  rules: { key: string; label: string; points: number; per_day: number }[];
};
export type MyStats = {
  xp: XP;
  followers: number; // COM-02
  following: number;
  sightings: number;
  species: number;
  identifications: number;
  reputation: Reputation;
  trusted_at: number; // confirmed IDs needed for Trusted
  trusted_accuracy: number; // percent
};
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
export const moderateComment = (token: string, id: number, action: 'hide' | 'restore' | 'dismiss', note = '') =>
  request<void>(`/mod/comments/${id}`, { method: 'POST', token, body: JSON.stringify({ action, note }) });

/** LRN-02 lessons. */
export type LessonSummary = { slug: string; title: string; blurb: string; birds: number; cover: string | null };
export type LessonBird = {
  id: number;
  english_name: string;
  scientific_name: string;
  family_en: string;
  image: string | null;
  sexes: string;
  voice: string;
  length: string;
  sound: SoundRecording | null;
  mnemonic: string; // LRN-08
};
export type FlashcardData = LessonBird & { tip: string };
export const speciesCards = (ids: number[]) => request<{ items: FlashcardData[] }>(`/species/cards?ids=${ids.join(',')}`);
export const familiesOf = (ids: string[]) =>
  request<Record<string, { family: string; name: string }>>(`/species/families-of?ids=${ids.join(',')}`);
export const listLessons = () => request<{ items: LessonSummary[] }>('/lessons');
export const getLesson = (slug: string) => request<{ slug: string; title: string; blurb: string; birds: LessonBird[] }>(`/lessons/${slug}`);

/** LRN-05 life list and suggestions. */
export type LifeBird = {
  id: number;
  english_name: string;
  scientific_name: string;
  thumb_url: string | null;
  first_seen: string;
  sightings: number;
  verified: boolean;
};
export type NextBird = { id: number; english_name: string; scientific_name: string; thumb_url: string | null; out_there_now: boolean };
export const lifeList = (token: string) => request<{ items: LifeBird[]; verified: number }>('/me/lifelist', { token });
/** LIB-13: birds recorded around a point (GBIF + trusted community sightings), with how common each is there. */
export type AreaBird = Species & { gbif: number; community: number; last_seen: string | null; rarity: 'common' | 'uncommon' | 'rare' };
export const areaChecklist = (lat: number, lng: number, km: number, token?: string) =>
  request<{ items: AreaBird[]; km: number; gbif_ok: boolean }>(`/area/checklist?lat=${lat}&lng=${lng}&km=${km}`, { token });
export const learnNext = (token: string) => request<{ items: NextBird[] }>('/me/learn-next', { token });

export const myStats = (token: string) => request<MyStats>('/me/stats', { token });
/** GAM-01: this week's challenges; progress and done only when signed in. */
export type Challenge = { id: number; kind: string; title: string; description: string; goal: number; progress: number; done: boolean };
export const weekChallenges = (token?: string) => request<{ items: Challenge[]; ends: string; xp: number }>('/challenges', { token });
/** GAM-06 seasonal events: agreed sightings in the window count. `mine` = the viewer's species (signed in). */
export type BirdEvent = {
  slug: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  species: number;
  sightings: number;
  people: number;
  mine: number | null;
};
export const listEvents = (token?: string) => request<{ items: BirdEvent[] }>('/events', { token });
export const getEvent = (slug: string, token?: string) =>
  request<{
    event: BirdEvent;
    top: { user: { id: number; display_name: string; avatar_url: string | null }; species: number }[];
    species_list: { id: number; english_name: string; scientific_name: string }[];
  }>(`/events/${slug}`, { token });

/** COM-03 groups and clubs (+ GAM-07 group challenges and private board). Members only. */
export type Group = {
  id: number;
  name: string;
  description: string;
  kind: 'club' | 'school' | 'friends';
  join_code: string;
  owner_id: number;
  members: number;
  created_at: string;
};
export type GroupDetail = {
  group: Group;
  members: { id: number; display_name: string; avatar_url: string | null; species: number; week_xp: number; owner: boolean }[];
  outings: { id: number; user: { id: number; display_name: string; avatar_url: string | null }; started_at: string; distance_m: number; species: number }[];
  challenges: { id: number; title: string; goal: number; starts_at: string; ends_at: string; species: number }[];
  week_ends: string;
};
export const myGroups = (token: string) => request<{ items: Group[] }>('/me/groups', { token });
export const createGroup = (token: string, g: { name: string; description: string; kind: Group['kind'] }) =>
  request<Group>('/groups', { method: 'POST', token, body: JSON.stringify(g) });
export const joinGroup = (token: string, code: string) => request<Group>('/groups/join', { method: 'POST', token, body: JSON.stringify({ code }) });
export const getGroup = (token: string, id: number) => request<GroupDetail>(`/groups/${id}`, { token });
export const groupSightings = (token: string, id: number, offset = 0) => request<Page<Observation>>(`/groups/${id}/sightings?offset=${offset}`, { token });
export const leaveGroup = (token: string, id: number, user: number | 'me' = 'me') =>
  request<void>(`/groups/${id}/members/${user}`, { method: 'DELETE', token });
export const deleteGroup = (token: string, id: number) => request<void>(`/groups/${id}`, { method: 'DELETE', token });
export const newGroupCode = (token: string, id: number) => request<{ join_code: string }>(`/groups/${id}/code`, { method: 'POST', token });
export const addGroupChallenge = (token: string, id: number, c: { title: string; goal: number; starts_at: string; ends_at: string }) =>
  request<unknown>(`/groups/${id}/challenges`, { method: 'POST', token, body: JSON.stringify(c) });

/** GAM-05: XP earned this week; scope near = people with a verified sighting within 50 km this week. */
export type BoardRow = { rank: number; user: { id: number; display_name: string; avatar_url: string | null }; xp: number; me: boolean };
export const leaderboard = (scope: 'week' | 'near', token?: string, near?: { lat: number; lng: number }) =>
  request<{ items: BoardRow[]; week: string; ends: string }>(
    `/leaderboard?scope=${scope}${near ? `&lat=${near.lat}&lng=${near.lng}` : ''}`,
    { token },
  );

/** GAM-03 badges and GAM-04 streaks (current run ends today/this week or the one before). */
export type Badge = { key: string; name: string; description: string; icon: string; progress: number; goal: number; earned: boolean };
export type Streak = { current: number; best: number };
export const myAchievements = (token: string) =>
  request<{ badges: Badge[]; earned: number; streaks: { daily_quiz: Streak; weekly_outing: Streak } }>('/me/achievements', { token });

export const deleteAccount = (token: string, password: string) =>
  request<void>('/me', { method: 'DELETE', token, body: JSON.stringify({ password, confirm: password }) }); // Google-only accounts type DELETE

export const exportAccount = (token: string) => request<Record<string, unknown>>('/me/export', { token });

export type ProfilePatch = Partial<
  Pick<User, 'display_name' | 'home_area' | 'experience_level' | 'bio' | 'default_licence' | 'hide_locations' | 'private_profile' | 'notify_ids' | 'notify_status' | 'notify_comments' | 'notify_reminders' | 'hide_from_leaderboards'>
>;

export const updateProfile = (token: string, patch: ProfilePatch) =>
  request<User>('/me', { method: 'PATCH', token, body: JSON.stringify(patch) });

async function uploadImage<T>(
  method: 'PUT' | 'POST',
  path: string,
  token: string,
  fileUri: string,
  fields: Record<string, string> = {},
) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  // React Native's FormData accepts a file descriptor object in place of a Blob.
  form.append('image', { uri: fileUri, name: 'image.jpg', type: 'image/jpeg' } as unknown as Blob);
  const res = await fetch(`${API_URL}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

export const uploadAvatar = (token: string, fileUri: string) => uploadImage<User>('PUT', '/me/avatar', token, fileUri);

export const deleteAvatar = (token: string) => request<void>('/me/avatar', { method: 'DELETE', token });

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
  uploadImage<Photo>('POST', `/observations/${observationId}/photos`, token, fileUri, { licence });

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

/** ADM-02 taxonomy admin. */
export const isAdmin = (u?: User | null) => u?.role === 'admin';
export const addLocalName = (token: string, speciesId: number, name: string, language: string) =>
  request<{ items: LocalName[] }>(`/admin/species/${speciesId}/names`, { method: 'POST', token, body: JSON.stringify({ name, language }) });
export const deleteLocalName = (token: string, speciesId: number, name: string) =>
  request<{ items: LocalName[] }>(`/admin/species/${speciesId}/names?name=${encodeURIComponent(name)}`, { method: 'DELETE', token });
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

export type Person = { id: number; display_name: string; email: string; role: Role; avatar_url: string | null };
export const searchPeople = (token: string, q: string) =>
  request<{ items: Person[] }>(`/admin/users?q=${encodeURIComponent(q)}`, { token });
export const setRole = (token: string, userId: number, role: Role) =>
  request<void>(`/admin/users/${userId}/role`, { method: 'PUT', token, body: JSON.stringify({ role }) });
export type SensitiveSpecies = { id: number; english_name: string; scientific_name: string; km: number; local: boolean };
export const listSensitive = (token: string) => request<{ items: SensitiveSpecies[] }>('/admin/sensitive', { token });
export const setSensitive = (token: string, speciesId: number, sensitive: boolean, km: number) =>
  request<void>(`/admin/species/${speciesId}/sensitive`, { method: 'PUT', token, body: JSON.stringify({ sensitive, km }) });
export const changeTaxonomy = (token: string, kind: 'merge' | 'split', from: number, into: number[], note: string) =>
  request<void>(`/admin/species/${kind}`, { method: 'POST', token, body: JSON.stringify({ from, into, note }) });
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

export const getSpecies = (id: number) => request<SpeciesDetail>(`/species/${id}`);

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
/** VER-08: would this species be unusual here, on this date? */
export const speciesLikely = (id: number, lat: number, lng: number, date: Date) =>
  request<{ unusual: '' | 'range' | 'season' }>(`/species/${id}/likely?lat=${lat}&lng=${lng}&date=${encodeURIComponent(date.toISOString())}`);

/** The species to show for an observation: the community's answer once there is one. */
export const shownSpecies = (o: Observation) => o.community_species ?? o.species;

export type QuizOption = { id: number; english_name: string; scientific_name: string };
export type QuizQuestion = {
  image?: { url: string; credit: string; licence: string; source_url: string };
  sound?: { url: string; spectrogram_url: string; credit: string; licence: string };
  media_ref: string;
  /** Why this bird came up: recorded by the community lately, looked up by you, a Sierra Leone bird, or anywhere. */
  reason: 'weak' | 'community' | 'yours' | 'local' | '';
  answer: QuizOption;
  options: QuizOption[];
  explanation: string;
};

/** Quiz scope: '' = your birds first, then Sierra Leone, a few from anywhere; week = recorded by the community lately; mine = focus only. */
/** QZ-04: near = birds recorded around lat/lng (area checklist); lifelist = the signed-in viewer's own birds. */
export type QuizScope = '' | 'week' | 'mine' | 'near' | 'lifelist' | 'group';
export const getQuiz = (
  kind: 'picture' | 'sound',
  opts: {
    family?: string;
    focus?: number[];
    scope?: QuizScope;
    species?: number[];
    level?: 'beginner' | 'intermediate' | 'expert';
    habitat?: string;
    season?: '' | 'rainy' | 'dry';
    near?: { lat: number; lng: number };
    group?: number; // COM-03
    token?: string;
  } = {},
) =>
  request<{ questions: QuizQuestion[] }>(
    `/quiz/${kind}?n=10&family=${encodeURIComponent(opts.family ?? '')}&scope=${opts.scope ?? ''}&focus=${(opts.focus ?? []).slice(0, 100).join(',')}&species=${(opts.species ?? []).join(',')}&level=${opts.level ?? ''}&habitat=${encodeURIComponent(opts.habitat ?? '')}&season=${opts.season ?? ''}${opts.near ? `&lat=${opts.near.lat}&lng=${opts.near.lng}` : ''}${opts.group ? `&group=${opts.group}` : ''}`,
    { token: opts.token },
  );

/** QZ-10 dawn chorus: songs played together; tick every singer among the options. */
export type ChorusRound = {
  songs: { url: string; spectrogram_url: string; credit: string; licence: string; species_id: number }[];
  answer: QuizQuestion['answer'][];
  options: QuizQuestion['answer'][];
};
export const chorusQuiz = (n = 5) => request<{ rounds: ChorusRound[] }>(`/quiz/chorus?n=${n}`);

/** QZ-11 head-to-head: a fixed quiz set under a code; the server marks the picks. */
export type Duel = {
  code: string;
  kind: 'picture' | 'sound';
  creator: { id: number; display_name: string; avatar_url: string | null };
  questions: QuizQuestion[];
  scores: { user: { id: number; display_name: string; avatar_url: string | null }; right: number; of: number; time_s: number; me: boolean }[];
  played: boolean;
  expires_at: string;
};
export const createDuel = (token: string, kind: 'picture' | 'sound') =>
  request<Duel>('/duels', { method: 'POST', token, body: JSON.stringify({ kind }) });
export const getDuel = (token: string, code: string) => request<Duel>(`/duels/${encodeURIComponent(code)}`, { token });
export const scoreDuel = (token: string, code: string, picks: number[], timeMs: number) =>
  request<Duel>(`/duels/${encodeURIComponent(code)}/score`, { method: 'POST', token, body: JSON.stringify({ picks, time_ms: timeMs }) });
export const myDuels = (token: string) =>
  request<{ items: { code: string; kind: string; creator: string; created_at: string; expires_at: string; players: number; mine: number | null }[] }>(
    '/me/duels',
    { token },
  );

/** QZ-07: lookalike pairs; which photo is the target? `tip` = the experts' way to tell them apart, if any. */
export type SpotBird = { id: number; english_name: string; scientific_name: string; photo: string; credit: string; length: string };
export type SpotRound = { target: SpotBird; birds: [SpotBird, SpotBird]; tip: string };
export const spotGame = (n = 6) => request<{ rounds: SpotRound[] }>(`/games/spot?n=${n}`);

/** QZ-12 (verifiers): keep a photo out of quizzes. ref = QuizQuestion.media_ref or `photo:<id>`. */
/** VER-07: mark a photo ("photo:<id>" from a verified sighting, or "gallery:<id>") as reference quality. */
/** LIB-08: what a photo shows. The sighting's observer or a verifier; gallery photos: verifiers. */
export type PhotoTag = 'male' | 'female' | 'juvenile' | 'adult' | 'breeding' | 'non-breeding' | 'in-flight';
/** LIB-09: what a community recording holds (ref "sound:<id>"). */
export type SoundTag = 'song' | 'call' | 'alarm' | 'flight';
export const setPhotoTags = (token: string, ref: string, tags: (PhotoTag | SoundTag)[]) =>
  request<{ tags: (PhotoTag | SoundTag)[] }>('/photos/tags', { method: 'PUT', token, body: JSON.stringify({ media_ref: ref, tags }) });

/** LIB-10: expert ID tips; `other` is the lookalike for a "how to tell them apart" tip, null for a general one. */
export type IdTip = { id: number; other: { id: number; english_name: string; scientific_name: string } | null; text: string; author: string; updated_at: string };
export const speciesTips = (id: number) => request<{ items: IdTip[] }>(`/species/${id}/tips`);
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

export const setReference = (token: string, ref: string, reference: boolean) =>
  request<void>('/verify/reference', { method: 'PUT', token, body: JSON.stringify({ media_ref: ref, reference }) });

export const setQuizSuitable = (token: string, ref: string, suitable: boolean) =>
  request<void>('/quiz/suitability', { method: 'PUT', token, body: JSON.stringify({ media_ref: ref, suitable }) });

export const isModerator = (u?: User | null) => !!u && ['moderator', 'admin'].includes(u.role);

/** ADM-01 moderation queue. */
export type FlaggedSighting = {
  id: number;
  species: string;
  thumb_url: string | null;
  observer: { id: number; display_name: string; avatar_url: string | null };
  hidden: boolean;
  reasons: Record<string, number>;
  notes: string[];
  first_flagged_at: string;
};
export type ReportedPerson = {
  user: { id: number; display_name: string; avatar_url: string | null };
  banned: boolean;
  suspended_until: string | null;
  reasons: Record<string, number>;
  notes: string[];
  warnings: number;
  first_reported_at: string;
};
export type ReportedComment = {
  id: number;
  observation_id: number;
  body: string;
  hidden: boolean;
  author: { id: number; display_name: string; avatar_url: string | null };
  reasons: Record<string, number>;
  reports: number;
};
export const modQueue = (token: string) =>
  request<{ sightings: FlaggedSighting[]; people: ReportedPerson[]; comments: ReportedComment[] }>('/mod/queue', { token });
export const moderateSighting = (token: string, id: number, action: 'hide' | 'restore' | 'remove' | 'dismiss', note = '') =>
  request<void>(`/mod/observations/${id}`, { method: 'POST', token, body: JSON.stringify({ action, note }) });
export const moderatePerson = (token: string, id: number, action: 'warn' | 'suspend' | 'ban' | 'unban' | 'dismiss', note = '', days = 0) =>
  request<void>(`/mod/users/${id}`, { method: 'POST', token, body: JSON.stringify({ action, note, days }) });

export const isVerifier = (u?: User | null) => !!u && ['verifier', 'moderator', 'admin'].includes(u.role);

export type CommunityPhoto = Photo & { observation_id: number; credit: string };

export const speciesPhotos = (id: number, offset = 0) => request<Page<CommunityPhoto>>(`/species/${id}/photos?offset=${offset}`);

/** OBS-03: duration + spectrogram (data URL) of an unsaved recording, for trimming. */
export async function previewAudio(token: string, fileUri: string, mimeType = 'audio/mp4') {
  const form = new FormData();
  form.append('audio', { uri: fileUri, name: 'recording.m4a', type: mimeType } as unknown as Blob);
  const res = await fetch(`${API_URL}/audio/preview`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  return body as { duration_s: number; max_clip_s: number; spectrogram: string };
}

export async function addSound(
  token: string,
  observationId: number,
  s: { uri: string; mimeType?: string; start: number; end: number },
  licence: Licence,
) {
  const form = new FormData();
  form.append('trim_start', s.start.toFixed(3));
  form.append('trim_end', s.end.toFixed(3));
  form.append('licence', licence);
  form.append('audio', { uri: s.uri, name: 'recording.m4a', type: s.mimeType ?? 'audio/mp4' } as unknown as Blob);
  const res = await fetch(`${API_URL}/observations/${observationId}/sounds`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  return body as Sound;
}

export const deleteSound = (token: string, observationId: number, soundId: number) =>
  request<void>(`/observations/${observationId}/sounds/${soundId}`, { method: 'DELETE', token });

export type Family = { family_sci: string; family_en: string; species: number };
export const listFamilies = () => request<{ items: Family[] }>('/families');

/** ADM-05: lessons and weekly challenges, written by admins. */
export type AdminLesson = {
  slug: string;
  title: string;
  blurb: string;
  families: string[];
  species_ids: number[];
  position: number;
  published: boolean;
};
export const adminLessons = (token: string) => request<{ items: AdminLesson[] }>('/admin/lessons', { token });
export const putLesson = (token: string, l: AdminLesson) =>
  request<AdminLesson>(`/admin/lessons/${l.slug}`, { method: 'PUT', token, body: JSON.stringify(l) });
export const deleteLesson = (token: string, slug: string) => request<void>(`/admin/lessons/${slug}`, { method: 'DELETE', token });
export type AdminChallenge = { id: number; week: string; kind: string; param: string; title: string; description: string; goal: number };
export const adminChallenges = (token: string) =>
  request<{ items: AdminChallenge[]; kinds: { kind: string; title: string }[] }>('/admin/challenges', { token });
/** ADM-06: the KPIs from BRD §2.2. */
export type WeekCount = { week: string; count: number };
export type Analytics = {
  library: { species: number; with_photo: number; photos3_pct: number; call_pct: number; lessons: number; expert_tips: number; reference: number };
  contribution: { uploads_per_week: WeekCount[]; reached_pct: number; verified: number };
  learning: { quizzes_per_week: WeekCount[]; improvement_pts: number | null; improvement_users: number };
  engagement: {
    dau: number;
    mau: number;
    dau_mau_pct: number;
    d7_pct: number | null;
    d30_pct: number | null;
    challenge_active: number;
    challenge_done: number;
    challenge_of: number;
  };
  reach: { anon_today: number; anon_7_days: number; accounts: number; new_week: number; devices: Record<string, number> };
  quality: { first_id_hours: number | null; resolution_hours: number | null; open_reports: number; awaiting_id: number };
};
/** ADM-07: a one-time (10 min) link to the Darwin Core CSV of verified sightings. */
export const exportLink = (token: string) => request<{ url: string }>('/admin/export-link', { method: 'POST', token });
export const adminAnalytics = (token: string) => request<Analytics>('/admin/analytics', { token });
export const putChallenge = (token: string, c: AdminChallenge) =>
  request<void>(`/admin/challenges/${c.id}`, { method: 'PUT', token, body: JSON.stringify(c) });

export type Site = { id: number; name: string; lat: number; lng: number; distance_m?: number };
export const nearbySites = (lat: number, lng: number) => request<{ items: Site[] }>(`/sites?near=${lat},${lng}`);
export const createSite = (token: string, name: string, lat: number, lng: number) =>
  request<Site>('/sites', { method: 'POST', token, body: JSON.stringify({ name, lat, lng }) });

export const acceptGuidelines = (token: string) => request<User>('/me/guidelines', { method: 'POST', token });

export type UserReportReason = 'spam' | 'harassment' | 'impersonation' | 'other';
/** COM-01: follow people; their verified sightings show in the activity feed. */
export const followUser = (token: string, id: number) => request<void>(`/users/${id}/follow`, { method: 'PUT', token });
export const unfollowUser = (token: string, id: number) => request<void>(`/users/${id}/follow`, { method: 'DELETE', token });
export const myFollowing = (token: string) =>
  request<{ items: { id: number; display_name: string; avatar_url: string | null }[] }>('/me/following', { token });
export const activityFeed = (scope: 'near' | 'following', offset: number, opts: { near?: { lat: number; lng: number }; token?: string }) =>
  request<Page<Observation>>(
    `/activity?scope=${scope}&offset=${offset}${opts.near ? `&lat=${opts.near.lat}&lng=${opts.near.lng}` : ''}`,
    { token: opts.token },
  );
export const likeSighting = (token: string, id: number, on: boolean) =>
  request<{ likes: number; liked: boolean }>(`/observations/${id}/like`, { method: on ? 'PUT' : 'DELETE', token });
/** COM-04 / NTF-03: rare birds verified within km of a place (opt-in). */
export type RareAlerts = { on: boolean; lat: number | null; lng: number | null; km: number };
export const getRareAlerts = (token: string) => request<RareAlerts>('/me/rare-alerts', { token });
export const putRareAlerts = (token: string, a: RareAlerts) =>
  request<RareAlerts>('/me/rare-alerts', { method: 'PUT', token, body: JSON.stringify(a) });
export const blockUser = (token: string, id: number) => request<void>(`/users/${id}/block`, { method: 'PUT', token });
export const unblockUser = (token: string, id: number) => request<void>(`/users/${id}/block`, { method: 'DELETE', token });
export const myBlocks = (token: string) =>
  request<{ items: { id: number; display_name: string; avatar_url: string | null }[] }>('/me/blocks', { token });
export const reportUser = (token: string, id: number, reason: UserReportReason) =>
  request<void>(`/users/${id}/report`, { method: 'POST', token, body: JSON.stringify({ reason }) });
