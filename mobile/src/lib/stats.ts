// Quiz progress (QZ-13 on the device, ACC-04 with the account), pure so it can be tested with plain Node.

export type QuizStats = {
  quizzes: number;
  answered: number;
  correct: number;
  bestStreak: number; // longest run of right answers in one quiz
  missed: Record<string, number>; // species id → times answered wrong (feeds "birds I got wrong" later)
  bySpecies?: Record<string, [number, number]>; // LRN-06: species id → [right, wrong]
  byKind?: Partial<Record<QuizKind, [number, number]>>; // picture | sound → [right, wrong]
};
export type QuizKind = 'picture' | 'sound';

export const emptyStats: QuizStats = { quizzes: 0, answered: 0, correct: 0, bestStreak: 0, missed: {}, bySpecies: {}, byKind: {} };

const MAX_MISSED = 300; // keep the file small

/** One quiz as a change to progress: right answers bring a bird's miss count down, wrong ones up. */
export function quizDelta(results: { speciesId: number; correct: boolean }[], kind: QuizKind = 'picture'): QuizStats {
  let run = 0;
  let best = 0;
  const missed: Record<string, number> = {};
  const bySpecies: Record<string, [number, number]> = {};
  for (const r of results) {
    const p = bySpecies[String(r.speciesId)] ?? [0, 0];
    bySpecies[String(r.speciesId)] = r.correct ? [p[0] + 1, p[1]] : [p[0], p[1] + 1];
    run = r.correct ? run + 1 : 0;
    best = Math.max(best, run);
    const k = String(r.speciesId);
    missed[k] = (missed[k] ?? 0) + (r.correct ? -1 : 1);
  }
  const right = results.filter((r) => r.correct).length;
  return {
    quizzes: 1,
    answered: results.length,
    correct: right,
    bestStreak: best,
    missed,
    bySpecies,
    byKind: { [kind]: [right, results.length - right] },
  };
}

/**
 * Adds a change to progress, like the server does (ACC-04). `pending` keeps negative miss counts, since they
 * still have to cancel misses stored on the server; totals drop birds at 0 and keep the 300 most missed.
 */
export function mergeStats(s: QuizStats, d: QuizStats, pending = false): QuizStats {
  const missed = { ...s.missed };
  for (const [k, v] of Object.entries(d.missed)) {
    missed[k] = (missed[k] ?? 0) + v;
    if (missed[k] === 0 || (!pending && missed[k] < 0)) delete missed[k];
  }
  const keys = Object.keys(missed);
  if (keys.length > MAX_MISSED) {
    for (const k of keys.sort((a, b) => missed[a] - missed[b]).slice(0, keys.length - MAX_MISSED)) delete missed[k];
  }
  return {
    bySpecies: addPairs(s.bySpecies, d.bySpecies) as Record<string, [number, number]>,
    byKind: addPairs(s.byKind, d.byKind),
    quizzes: s.quizzes + d.quizzes,
    answered: s.answered + d.answered,
    correct: s.correct + d.correct,
    bestStreak: Math.max(s.bestStreak, d.bestStreak),
    missed,
  };
}

function addPairs<K extends string>(a: Partial<Record<K, [number, number]>> = {}, b: Partial<Record<K, [number, number]>> = {}) {
  const out: Partial<Record<K, [number, number]>> = { ...a };
  for (const [k, v] of Object.entries(b) as [K, [number, number]][]) {
    const p = out[k] ?? [0, 0];
    out[k] = [p[0] + v[0], p[1] + v[1]];
  }
  return out;
}

/** LRN-06: a bird is mastered at 3+ right answers with 80%+ right. */
export const mastered = ([right, wrong]: [number, number]) => right >= 3 && right / (right + wrong) >= 0.8;

export const applyQuiz = (stats: QuizStats, results: { speciesId: number; correct: boolean }[]) => mergeStats(stats, quizDelta(results));

export const accuracy = (s: QuizStats) => (s.answered ? Math.round((100 * s.correct) / s.answered) : 0);
