import { request } from './client';
import type { SoundRecording } from './species';

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

export const learnNext = (token: string) => request<{ items: NextBird[] }>('/me/learn-next', { token });
