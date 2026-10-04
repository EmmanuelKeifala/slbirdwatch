import { Feather, FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { myAchievements, myStats, type XP } from '@/api';
import { LevelBar } from '@/components/LevelBar';
import { Pressable } from '@/components/Pressable';
import { signInFirst } from '@/lib/nav';
import { font, radius, space, useColors } from '@/theme';

/**
 * Top of the Games tab: where you stand and what today is worth. Level and the bar to the next one, the
 * daily streak (and whether today's round is still to play), and how much of today's quiz XP is left.
 */
export function PlayerCard({ token }: { token?: string }) {
  const c = useColors();
  const [data, setData] = useState<{ xp: XP; streak: number } | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!token) return setData(null);
      Promise.all([myStats(token), myAchievements(token)]).then(
        ([s, a]) => setData({ xp: s.xp, streak: a.streaks.daily_quiz.current }),
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
  const cap = xp.rules.find((r) => r.key === 'quiz')?.per_day ?? 0;
  const today = Math.min(xp.today.quiz ?? 0, cap);
  const played = (xp.today.quiz ?? 0) > 0;
  return (
    <Pressable onPress={() => router.push('/achievements')} accessibilityRole="button" accessibilityHint="Opens badges and streaks">
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <LevelBar xp={xp} light />
        <View style={styles.row}>
          <View style={styles.stat}>
            <FontAwesome name="fire" size={18} color={played ? '#FFB347' : 'rgba(255,255,255,0.5)'} />
            <View>
              <Text style={styles.statNum}>
                {streak} day{streak === 1 ? '' : 's'}
              </Text>
              <Text style={styles.statHint}>{played ? 'streak, safe for today' : streak ? 'play today to keep it' : 'play today to start one'}</Text>
            </View>
          </View>
          {cap > 0 && (
            <View style={styles.stat}>
              <Feather name="zap" size={18} color="#FFFFFF" />
              <View>
                <Text style={styles.statNum}>
                  {today} / {cap} XP
                </Text>
                <Text style={styles.statHint}>{today >= cap ? 'today’s quiz XP earned' : 'from games today'}</Text>
              </View>
            </View>
          )}
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, padding: space.l, gap: space.l },
  title: { fontFamily: font.display, fontSize: 22, color: '#FFFFFF' },
  text: { fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.85)' },
  row: { flexDirection: 'row', gap: space.l },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.s },
  statNum: { fontFamily: font.bold, fontSize: 15, color: '#FFFFFF' },
  statHint: { fontFamily: font.medium, fontSize: 11, color: 'rgba(255,255,255,0.75)' },
});
