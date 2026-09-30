import { request } from './client';

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
