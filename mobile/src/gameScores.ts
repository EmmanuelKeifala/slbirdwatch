import { File, Paths } from 'expo-file-system';

// QZ-08/09: best scores for the quick games, kept on the phone.
type Best = Partial<Record<'speed' | 'reveal', number>>;
const file = () => new File(Paths.document, 'game-best.json');

export function bestScores(): Best {
  try {
    const f = file();
    return f.exists ? (JSON.parse(f.textSync()) as Best) : {};
  } catch {
    return {};
  }
}

/** Records the score; returns true when it beats the previous best. */
export function recordScore(game: 'speed' | 'reveal', score: number): boolean {
  const best = bestScores();
  if (score <= (best[game] ?? 0)) return false;
  try {
    file().write(JSON.stringify({ ...best, [game]: score }));
  } catch {
    // Storage unavailable: no record kept.
  }
  return true;
}
