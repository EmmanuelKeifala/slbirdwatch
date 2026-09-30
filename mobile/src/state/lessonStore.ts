import { File, Paths } from 'expo-file-system';

// LRN-02: best quiz score per lesson, on the phone. A lesson counts as done at 70% or more.
const file = () => new File(Paths.document, 'lessons.json');
export const PASS = 70;

export function lessonScores(): Record<string, number> {
  try {
    const f = file();
    return f.exists ? (JSON.parse(f.textSync()) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function recordLesson(slug: string, percent: number) {
  const all = lessonScores();
  if ((all[slug] ?? -1) >= percent) return;
  try {
    file().write(JSON.stringify({ ...all, [slug]: percent }));
  } catch {
    // storage unavailable: the score just isn't remembered
  }
}
