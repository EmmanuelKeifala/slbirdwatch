import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { myAchievements, myStats, type Streak, type XP } from '@/api';
import { LevelBar } from '@/components/LevelBar';
import { Pressable } from '@/components/Pressable';
import { StreakBar } from '@/components/StreakBar';
import { DAILY_GOAL } from '@/lib/goals';
import { signInFirst } from '@/lib/nav';
import { font, radius, space, useColors } from '@/theme';

/**
 * Top of the Games tab: where you stand and what's within reach. Level and the bar to the next one, the
 * streak's progress to its next milestone, and today's goal: ten right answers, one segment each.
 */
export function PlayerCard({ token }: { token?: string }) {
  const c = useColors();
  const [data, setData] = useState<{ xp: XP; streak: Streak } | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!token) return setData(null);
      Promise.all([myStats(token), myAchievements(token)]).then(
        ([s, a]) => setData({ xp: s.xp, streak: a.streaks.daily_quiz }),
        () => {},
      );
    }, [token]),
  );

  const gradient = [c.night[0], c.night[1], c.night[2]] as const;
  if (!token) {
    return (
      <Pressable onPress={() => signInFirst('Sign in to earn XP, build a streak and climb the leaderboard.')} accessibilityRole="button">
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
          <Text style={styles.title}>Play for keeps</Text>
          <Text style={styles.text}>Sign in and every right answer earns XP, builds your daily streak and moves you up the board.</Text>
        </LinearGradient>
      </Pressable>
    );
  }
  if (!data) return null;

  const { xp, streak } = data;
  const today = xp.today.quiz ?? 0; // right answers today
  const done = today >= DAILY_GOAL;
  return (
    <Pressable onPress={() => router.push('/achievements')} accessibilityRole="button" accessibilityHint="Opens badges and streaks">
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <LevelBar xp={xp} light />
        <StreakBar days={streak.current} lit={today > 0} light freezes={streak.freezes} />
        <View style={styles.goal} accessible accessibilityLabel={`Today's goal: ${Math.min(today, DAILY_GOAL)} of ${DAILY_GOAL} right answers`}>
          <Feather name={done ? 'check-circle' : 'target'} size={16} color="#FFFFFF" />
          <Text style={styles.goalText}>
            {done
              ? 'Today’s goal done. See you tomorrow!'
              : today
                ? `${DAILY_GOAL - today} more right answers to finish today’s goal`
                : streak.frozen
                  ? `A freeze is holding your streak. One round today keeps it going`
                  : streak.current
                    ? `One round today keeps your streak. Today’s goal: ${DAILY_GOAL} right answers`
                    : `One round today starts a streak. Today’s goal: ${DAILY_GOAL} right answers`}
          </Text>
          <View style={styles.dots}>
            {Array.from({ length: DAILY_GOAL }, (_, k) => (
              <View key={k} style={[styles.dot, k < today && styles.dotOn]} />
            ))}
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, padding: space.l, gap: space.l },
  title: { fontFamily: font.display, fontSize: 22, color: '#FFFFFF' },
  text: { fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.85)' },
  goal: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s },
  goalText: { flex: 1, fontFamily: font.semibold, fontSize: 13, color: '#FFFFFF' },
  dots: { flexBasis: '100%', flexDirection: 'row', gap: 4 },
  dot: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)' },
  dotOn: { backgroundColor: '#FFFFFF' },
});
