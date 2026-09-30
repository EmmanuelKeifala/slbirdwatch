import type { Licence } from '@/lib/licences';
import type { QuizStats } from '@/lib/stats';

import { request, file, upload } from './client';

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

export type Session = { token: string; user: User };

export const signUp = (email: string, password: string, display_name: string) =>
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

export const myStats = (token: string) => request<MyStats>('/me/stats', { token });

export const deleteAccount = (token: string, password: string) =>
  request<void>('/me', { method: 'DELETE', token, body: JSON.stringify({ password, confirm: password }) }); // Google-only accounts type DELETE

export const exportAccount = (token: string) => request<Record<string, unknown>>('/me/export', { token });

export type ProfilePatch = Partial<
  Pick<User, 'display_name' | 'home_area' | 'experience_level' | 'bio' | 'default_licence' | 'hide_locations' | 'private_profile' | 'notify_ids' | 'notify_status' | 'notify_comments' | 'notify_reminders' | 'hide_from_leaderboards'>
>;

export const updateProfile = (token: string, patch: ProfilePatch) =>
  request<User>('/me', { method: 'PATCH', token, body: JSON.stringify(patch) });

export const uploadAvatar = (token: string, fileUri: string) =>
  upload<User>('PUT', '/me/avatar', token, { image: file(fileUri, 'image.jpg', 'image/jpeg') });

export const deleteAvatar = (token: string) => request<void>('/me/avatar', { method: 'DELETE', token });

export const acceptGuidelines = (token: string) => request<User>('/me/guidelines', { method: 'POST', token });

/** COM-04 / NTF-03: rare birds verified within km of a place (opt-in). */
export type RareAlerts = { on: boolean; lat: number | null; lng: number | null; km: number };
export const getRareAlerts = (token: string) => request<RareAlerts>('/me/rare-alerts', { token });
export const putRareAlerts = (token: string, a: RareAlerts) =>
  request<RareAlerts>('/me/rare-alerts', { method: 'PUT', token, body: JSON.stringify(a) });

export const isAdmin = (u?: User | null) => u?.role === 'admin';

export const isModerator = (u?: User | null) => !!u && ['moderator', 'admin'].includes(u.role);

export const isVerifier = (u?: User | null) => !!u && ['verifier', 'moderator', 'admin'].includes(u.role);
