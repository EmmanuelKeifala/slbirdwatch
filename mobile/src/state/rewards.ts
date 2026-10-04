import { File, Paths } from 'expo-file-system';

import { leaderboard, myAchievements, myStats, type Badge, type XP } from '@/api';
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
  /** Streak freezes held. */
  freezes: number;
  /** This round came after a missed day that a freeze covered: the streak would have ended without it. */
  saved: boolean;
  /** Badges earned since this phone last looked. */
  newBadges: Badge[];
  /** This was today's first scoring round: the one that extended the streak. */
  firstToday: boolean;
  /** Place on this week's board, and the person just ahead (absent at the top, or when hidden from boards). */
  board: { rank: number; ahead?: { name: string; gap: number } } | null;
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
  const [stats, ach, week] = await Promise.all([
    myStats(token),
    myAchievements(token),
    leaderboard('week', token).catch(() => null), // the board is a bonus: the rewards show without it
  ]);
  const mine = week?.items.findIndex((r) => r.me) ?? -1;
  const above = mine > 0 ? week!.items[mine - 1] : undefined;
  const xp = stats.xp;
  const rule = xp.rules.find((r) => r.key === 'quiz');
  const cap = rule?.per_day || Infinity;
  const today = xp.today.quiz ?? 0; // right answers today, before the cap
  const gained = xpGained(today, correct, cap, rule?.points);
  const firstToday = correct > 0 && today - correct <= 0;
  return {
    gained,
    capped: today >= cap,
    levelUp: gained > 0 && xp.xp - gained < xp.level_at,
    xp,
    streak: ach.streaks.daily_quiz.current,
    newBadges: unseen(ach.badges.filter((b) => b.earned)),
    firstToday,
    freezes: ach.streaks.daily_quiz.freezes,
    saved: firstToday && ach.streaks.daily_quiz.bridged > 0,
    board:
      mine < 0
        ? null
        : { rank: week!.items[mine].rank, ahead: above && { name: above.user.display_name, gap: above.xp - week!.items[mine].xp } },
  };
}
