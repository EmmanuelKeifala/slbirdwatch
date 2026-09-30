import { request } from './client';
import type { Role } from './account';

export type Person = { id: number; display_name: string; email: string; role: Role; avatar_url: string | null };
export const searchPeople = (token: string, q: string) =>
  request<{ items: Person[] }>(`/admin/users?q=${encodeURIComponent(q)}`, { token });
export const setRole = (token: string, userId: number, role: Role) =>
  request<void>(`/admin/users/${userId}/role`, { method: 'PUT', token, body: JSON.stringify({ role }) });

export const moderateComment = (token: string, id: number, action: 'hide' | 'restore' | 'dismiss', note = '') =>
  request<void>(`/mod/comments/${id}`, { method: 'POST', token, body: JSON.stringify({ action, note }) });

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
