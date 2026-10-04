import { Feather, FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Confetti } from '@/components/Confetti';
import { LevelBar } from '@/components/LevelBar';
import { Pressable } from '@/components/Pressable';
import { StreakBar } from '@/components/StreakBar';
import { isMilestone } from '@/lib/goals';
import { close, signInFirst } from '@/lib/nav';
import { useAuth } from '@/state/auth';
import { saveQuiz } from '@/state/quizStore';
import { roundRewards, type Rewards } from '@/state/rewards';
import { font, radius, space, useColors } from '@/theme';

type Icon = ComponentProps<typeof Feather>['name'];
/** One answer; `name` lets the screen list the birds to look at again. */
export type GameResult = { speciesId: number; correct: boolean; name?: string };

/**
 * The end of every game: the score counts up, stars or a "new best" land, and the round's rewards follow —
 * XP earned, the level bar filling, the streak's progress to its next milestone, your place on this week's
 * board, any badge just earned, and the birds you missed, a tap away. It saves the round's answers
 * itself (once), so the rewards it shows are the ones the account really got.
 */
export function GameOver({
  icon,
  score,
  outOf,
  record,
  message,
  results,
  kind = 'picture',
  onAgain,
  children,
}: {
  icon: Icon;
  score: number;
  /** For games with a fixed number of rounds: shows "7 / 10" and one to three stars. */
  outOf?: number;
  /** For open-ended scores: this one beat the player's best. */
  record?: boolean;
  message: string;
  /** The round's answers, read once when the screen opens. */
  results: () => GameResult[];
  kind?: 'picture' | 'sound';
  onAgain?: () => void;
  children?: ReactNode;
}) {
  const c = useColors();
  const token = useAuth().session?.token;
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [answers] = useState(results); // read once, when the screen opens
  const saved = useRef(false);
  useEffect(() => {
    if (saved.current) return;
    saved.current = true;
    if (!answers.length) return;
    saveQuiz(answers, token, kind)
      .then(() => (token ? roundRewards(token, answers.filter((r) => r.correct).length) : null))
      .then(setRewards, () => {}); // offline: the answers stay on the phone and the plain score shows
  }, [answers, token, kind]);
  const wrong = new Map<number, string>();
  for (const a of answers) if (!a.correct && a.name) wrong.set(a.speciesId, a.name);
  const missed = [...wrong].slice(0, 6).map(([id, name]) => ({ id, name }));

  const stars = outOf ? (score >= outOf * 0.9 ? 3 : score >= outOf * 0.6 ? 2 : score > 0 ? 1 : 0) : 0;
  // the day a streak reaches 3, 7, 14, 30… and this round was the one that got it there
  const milestone = !!rewards && rewards.firstToday && isMilestone(rewards.streak);
  const big = stars === 3 || !!record || milestone || !!rewards?.levelUp || !!rewards?.newBadges.length;
  useEffect(() => {
    if (big) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [big]);

  const shown = useCountUp(score);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={styles.content}>
        {outOf ? (
          <View style={styles.stars} accessible accessibilityLabel={`${stars} of 3 stars`}>
            {[1, 2, 3].map((n) => (
              <Animated.View key={n} entering={ZoomIn.delay(250 * n).springify().damping(9)}>
                <FontAwesome name="star" size={n === 2 ? 52 : 40} color={n <= stars ? c.rare : c.border} style={n === 2 && styles.midStar} />
              </Animated.View>
            ))}
          </View>
        ) : (
          <Animated.View entering={ZoomIn.springify().damping(9)} style={[styles.icon, { backgroundColor: c.tint }]}>
            <Feather name={icon} size={34} color={c.accentDeep} />
          </Animated.View>
        )}

        <Text style={[styles.score, { color: c.ink }]} accessibilityLabel={outOf ? `${score} of ${outOf}` : `${score} points`}>
          {shown}
          {outOf ? <Text style={{ color: c.inkFaint }}> / {outOf}</Text> : null}
        </Text>
        {record && (
          <Animated.View entering={ZoomIn.delay(700).springify()} style={[styles.pill, { backgroundColor: c.rare }]}>
            <Feather name="trending-up" size={14} color={c.ink} />
            <Text style={[styles.pillText, { color: c.ink }]}>New best</Text>
          </Animated.View>
        )}
        <Text style={[styles.message, { color: c.inkMuted }]}>{message}</Text>

        {rewards ? (
          <Animated.View entering={FadeInDown.delay(600)} style={[styles.card, { borderColor: c.border }]}>
            <View style={styles.chips}>
              <View style={[styles.pill, { backgroundColor: c.tint }]}>
                <Feather name="zap" size={14} color={c.accentDeep} />
                <Text style={[styles.pillText, { color: c.accentDeep }]}>+{rewards.gained} XP</Text>
              </View>
              {rewards.board && (
                <View style={[styles.pill, { backgroundColor: c.tiles[4] }]}>
                  <Feather name="bar-chart-2" size={14} color={c.ink} />
                  <Text style={[styles.pillText, { color: c.ink }]}>#{rewards.board.rank} this week</Text>
                </View>
              )}
            </View>
            {rewards.levelUp && (
              <Animated.Text entering={ZoomIn.delay(1500).springify()} style={[styles.levelUp, { color: c.accentDeep }]}>
                Level up! You’re now a {rewards.xp.level_name}.
              </Animated.Text>
            )}
            <LevelBar xp={rewards.xp} gained={rewards.levelUp ? rewards.xp.xp - rewards.xp.level_at : rewards.gained} />
            {milestone && (
              <Animated.Text entering={ZoomIn.delay(1500).springify()} style={[styles.levelUp, { color: c.ink }]}>
                {rewards.streak} days in a row!
              </Animated.Text>
            )}
            {rewards.streak > 0 && <StreakBar days={rewards.streak} />}
            {rewards.board?.ahead && rewards.board.ahead.gap > 0 && (
              <Text style={[styles.note, { color: c.inkMuted }]}>
                {rewards.board.ahead.gap} XP behind {rewards.board.ahead.name} on this week’s board.
              </Text>
            )}
            {rewards.capped && (
              <Text style={[styles.note, { color: c.inkMuted }]}>
                You’ve earned all of today’s quiz XP. Keep playing for practice, or log a sighting for more.
              </Text>
            )}
          </Animated.View>
        ) : (
          !token && (
            <Pressable
              style={[styles.card, { borderColor: c.border }]}
              onPress={() => signInFirst('Sign in to earn XP, build a streak and climb the leaderboard.')}
              accessibilityRole="button"
            >
              <Text style={[styles.levelUp, { color: c.ink }]}>Make it count</Text>
              <Text style={[styles.note, { color: c.inkMuted }]}>Sign in to turn rounds like this into XP, streaks and badges.</Text>
            </Pressable>
          )
        )}

        {rewards?.newBadges.map((b, k) => (
          <Animated.View key={b.key} entering={ZoomIn.delay(1200 + 300 * k).springify()} style={[styles.badge, { backgroundColor: c.primary }]}>
            <View style={styles.badgeIcon}>
              <Feather name="award" size={22} color={c.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.badgeKicker}>NEW BADGE</Text>
              <Text style={styles.badgeName}>{b.name}</Text>
              <Text style={styles.badgeText}>{b.description}</Text>
            </View>
          </Animated.View>
        ))}

        {missed.length > 0 && (
          <Animated.View entering={FadeInDown.delay(900)} style={styles.missed}>
            <Text style={[styles.missedTitle, { color: c.ink }]}>Worth another look</Text>
            <Text style={[styles.note, { color: c.inkMuted }]}>The birds you missed. Getting one wrong, then looking it up, is how it sticks.</Text>
            <View style={styles.chips}>
              {missed.map((b) => (
                <Pressable
                  key={b.id}
                  style={[styles.pill, { backgroundColor: c.field }]}
                  onPress={() => router.push(`/species/${b.id}`)}
                  accessibilityRole="link"
                >
                  <Text style={[styles.birdText, { color: c.ink }]} numberOfLines={1}>
                    {b.name}
                  </Text>
                  <Feather name="chevron-right" size={14} color={c.inkFaint} />
                </Pressable>
              ))}
            </View>
          </Animated.View>
        )}

        {children}

        {onAgain && (
          <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={onAgain} accessibilityRole="button">
            <Text style={[styles.primaryText, { color: c.onPrimary }]}>Play again</Text>
          </Pressable>
        )}
        <Pressable onPress={close} accessibilityRole="button" style={styles.done}>
          <Text style={[styles.doneText, { color: onAgain ? c.inkMuted : c.accentDeep }]}>Done</Text>
        </Pressable>
      </ScrollView>
      {big && <Confetti />}
    </SafeAreaView>
  );
}

/** Counts from 0 to `to` over about 0.7 s. */
function useCountUp(to: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (to <= 0) return;
    const steps = Math.min(to, 20);
    let k = 0;
    const t = setInterval(() => {
      k += 1;
      setN(Math.round((to * k) / steps));
      if (k >= steps) clearInterval(t);
    }, 700 / steps);
    return () => clearInterval(t);
  }, [to]);
  return to <= 0 ? to : n;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.m },
  stars: { flexDirection: 'row', alignItems: 'flex-end', gap: space.m },
  midStar: { marginBottom: 10 },
  icon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  score: { fontFamily: font.display, fontSize: 64, lineHeight: 70 },
  message: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  card: { alignSelf: 'stretch', borderWidth: 1.5, borderRadius: radius.card, padding: space.l, gap: space.m, marginTop: space.s },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: space.m, height: 32 },
  pillText: { fontFamily: font.bold, fontSize: 14 },
  levelUp: { fontFamily: font.display, fontSize: 20 },
  note: { fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  missed: { alignSelf: 'stretch', gap: space.s, marginTop: space.s },
  missedTitle: { fontFamily: font.display, fontSize: 18 },
  birdText: { fontFamily: font.semibold, fontSize: 13, flexShrink: 1 },
  badge: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: space.m, borderRadius: radius.card, padding: space.l },
  badgeIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  badgeKicker: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1, color: '#C9C2FF' },
  badgeName: { fontFamily: font.display, fontSize: 18, color: '#FFFFFF' },
  badgeText: { fontFamily: font.medium, fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  primary: { alignSelf: 'stretch', height: 56, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginTop: space.m },
  primaryText: { fontFamily: font.semibold, fontSize: 16 },
  done: { paddingVertical: space.s },
  doneText: { fontFamily: font.semibold, fontSize: 14 },
});
