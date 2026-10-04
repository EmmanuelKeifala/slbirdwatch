/**
 * XP a round added, given today's right answers *including* this round. Only the first `cap` right answers
 * of a day earn XP, so a round that straddles the cap earns part, and one after it earns nothing.
 */
export function xpGained(today: number, correct: number, cap: number, points = 1): number {
  const before = Math.max(today - correct, 0);
  return points * Math.max(0, Math.min(today, cap) - Math.min(before, cap));
}
