// Engagement goals, shaped by what the research on streaks and goal pursuit found: a near, concrete target
// pulls harder than a distant one (people speed up as they close in), so a streak always aims at the next
// milestone, and a day's goal is a handful of right answers rather than the 50-XP daily cap.

const MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];

/** The milestone a streak of `days` is working towards, and the one before it (0 at the start). */
export function streakGoal(days: number): { from: number; to: number } {
  const i = MILESTONES.findIndex((m) => m > days);
  if (i < 0) return { from: MILESTONES[MILESTONES.length - 1], to: Math.ceil((days + 1) / 100) * 100 };
  return { from: i ? MILESTONES[i - 1] : 0, to: MILESTONES[i] };
}

/** True when `days` is exactly a milestone: the day to celebrate. */
export const isMilestone = (days: number) => MILESTONES.includes(days);

/** Right answers that make a day "done". Small on purpose: showing up daily matters more than how much. */
export const DAILY_GOAL = 10;
