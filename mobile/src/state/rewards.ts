import { File, Paths } from 'expo-file-system';

import { myAchievements, myStats, type Badge, type XP } from '@/api';
import { xpGained } from '@/lib/xp';

/** What a finished round earned, for the end-of-game screen. */
export type Rewards = {
  /** XP this round added (correct answers, up to the daily quiz cap). */
  gained: number;
  /** Today's quiz XP is used up: more rounds are practice only. */
  capped: boolean;
  /** This round carried the player into `xp.level`. */
  levelUp: boolean;
  xp: XP;
  /** Daily quiz streak, in days, counting today. */
  streak: number;
  /** Badges earned since this phone last looked. */
  newBadges: Badge[];
};

// Badge keys this phone has already celebrated, so each badge is announced once.
const seenFile = () => new File(Paths.document, 'badges-seen.json');

function unseen(earned: Badge[]): Badge[] {
  const f = seenFile();
  let seen: string[] | null = null;
  try {
    if (f.exists) seen = JSON.parse(f.textSync()) as string[];
  } catch {}
  try {
    f.write(JSON.stringify(earned.map((b) => b.key)));
  } catch {}
  // First look on this phone: badges from before aren't news.
  return seen ? earned.filter((b) => !seen.includes(b.key)) : [];
}

/** Call after the round's results reached the account. `correct` = right answers in the round. */
export async function roundRewards(token: string, correct: number): Promise<Rewards> {
  const [stats, ach] = await Promise.all([myStats(token), myAchievements(token)]);
  const xp = stats.xp;
  const rule = xp.rules.find((r) => r.key === 'quiz');
  const cap = rule?.per_day || Infinity;
  const today = xp.today.quiz ?? 0; // right answers today, before the cap
  const gained = xpGained(today, correct, cap, rule?.points);
  return {
    gained,
    capped: today >= cap,
    levelUp: gained > 0 && xp.xp - gained < xp.level_at,
    xp,
    streak: ach.streaks.daily_quiz.current,
    newBadges: unseen(ach.badges.filter((b) => b.earned)),
  };
}
