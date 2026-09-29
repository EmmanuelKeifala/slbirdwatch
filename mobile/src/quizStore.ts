import { File, Paths } from 'expo-file-system';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { addQuizStats, getQuizStats } from '@/api';
import { emptyStats, mergeStats, quizDelta, type QuizKind, type QuizStats } from '@/stats';

// QZ-13 / ACC-04: finished quizzes are saved on the phone as *pending changes*. A guest's stay there; once
// signed in they're added to the account's progress on the server (then cleared here), so progress made as
// a guest carries over at sign-up and nothing is counted twice.
const file = () => new File(Paths.document, 'quiz-stats.json');
let serverTotal: QuizStats | null = null; // last known account progress

/** Changes not yet on the server (a guest's whole progress). */
export function loadStats(): QuizStats {
  try {
    const f = file();
    return f.exists ? { ...emptyStats, ...JSON.parse(f.textSync()) } : emptyStats;
  } catch {
    return emptyStats; // unreadable file: start fresh rather than crash
  }
}

function writePending(s: QuizStats | null) {
  try {
    if (s) file().write(JSON.stringify(s));
    else if (file().exists) file().delete();
  } catch {
    // storage unavailable: this quiz isn't kept, the quiz itself still worked
  }
}

/** Progress to show: the account's (when signed in) plus anything still on the phone. */
export const currentStats = (): QuizStats => mergeStats(serverTotal ?? emptyStats, loadStats());

/** Save a finished quiz, then try to add it to the account. */
export async function saveQuiz(
  results: { speciesId: number; correct: boolean }[],
  token?: string,
  kind: QuizKind = 'picture',
): Promise<QuizStats> {
  writePending(mergeStats(loadStats(), quizDelta(results, kind), true));
  if (token) await syncQuiz(token);
  return currentStats();
}

let queue: Promise<void> = Promise.resolve();

/**
 * Send pending changes (e.g. a guest's progress right after signing in) and refresh the account total.
 * Queued one after another: two overlapping sends would add the same changes twice.
 */
export function syncQuiz(token: string): Promise<void> {
  queue = queue.then(() => sendPending(token)); // sendPending never rejects
  return queue;
}

async function sendPending(token: string): Promise<void> {
  try {
    const pending = loadStats();
    if (pending.quizzes > 0 || Object.keys(pending.missed).length) {
      serverTotal = await addQuizStats(token, pending);
      writePending(null);
    } else {
      serverTotal = await getQuizStats(token);
    }
  } catch {
    // offline: pending changes stay on the phone and go up next time
  }
}

export const forgetAccountStats = () => {
  serverTotal = null; // signed out: show only what's on this phone
};

/** Stats for a screen, refreshed each time it comes into view. */
export function useQuizStats(token: string | undefined): QuizStats {
  const [stats, setStats] = useState(currentStats);
  useFocusEffect(
    useCallback(() => {
      setStats(currentStats());
      if (!token) return;
      syncQuiz(token).then(() => setStats(currentStats()));
    }, [token]),
  );
  return stats;
}
