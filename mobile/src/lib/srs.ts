// LRN-04 spaced repetition (SM-2), pure so `npm test` can check it.

export type Card = { speciesId: number; ease: number; interval: number; reps: number; due: number }; // interval in days, due = epoch ms
export type Grade = 'again' | 'hard' | 'good' | 'easy';

const DAY = 86_400_000;
const Q: Record<Grade, number> = { again: 1, hard: 3, good: 4, easy: 5 }; // SM-2 quality

export const newCard = (speciesId: number, now: number): Card => ({ speciesId, ease: 2.5, interval: 0, reps: 0, due: now });

/** Schedule the next review after answering with `grade`. "Again" comes back in 10 minutes. */
export function review(card: Card, grade: Grade, now: number): Card {
  const q = Q[grade];
  const ease = Math.max(1.3, card.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  if (q < 3) return { ...card, ease, reps: 0, interval: 0, due: now + 10 * 60_000 };
  const interval = card.reps === 0 ? 1 : card.reps === 1 ? 6 : Math.round(card.interval * ease);
  const days = grade === 'easy' ? Math.round(interval * 1.3) : grade === 'hard' ? Math.max(1, Math.round(interval * 0.8)) : interval;
  return { ...card, ease, reps: card.reps + 1, interval: days, due: now + days * DAY };
}

/** Button label: when the card would come back. */
export function nextLabel(card: Card, grade: Grade, now: number): string {
  const ms = review(card, grade, now).due - now;
  if (ms < DAY) return `${Math.round(ms / 60_000)} min`;
  const d = Math.round(ms / DAY);
  return d < 30 ? `${d} d` : `${Math.round(d / 30)} mo`;
}

export const dueCards = (cards: Card[], now: number) => cards.filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
