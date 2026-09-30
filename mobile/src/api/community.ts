import { type Page, request } from './client';
import type { Observation } from './observations';

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

export const blockUser = (token: string, id: number) => request<void>(`/users/${id}/block`, { method: 'PUT', token });
export const unblockUser = (token: string, id: number) => request<void>(`/users/${id}/block`, { method: 'DELETE', token });
export const myBlocks = (token: string) =>
  request<{ items: { id: number; display_name: string; avatar_url: string | null }[] }>('/me/blocks', { token });
export const reportUser = (token: string, id: number, reason: UserReportReason) =>
  request<void>(`/users/${id}/report`, { method: 'POST', token, body: JSON.stringify({ reason }) });
