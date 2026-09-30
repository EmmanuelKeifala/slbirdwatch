import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/state/auth';
import { Challenges } from '@/components/Challenges';
import { EventBanner } from '@/components/EventBanner';
import { Games } from '@/components/Games';
import { signInFirst } from '@/lib/nav';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

type Icon = ComponentProps<typeof Feather>['name'];

/** The fun side, in one tab: the seasonal event, this week's challenges, the games, the board and your badges. */
export default function GamesTab() {
  const c = useColors();
  const { session } = useAuth();
  const link = (icon: Icon, title: string, hint: string, go: () => void) => (
    <Pressable style={[styles.row, { borderColor: c.border }]} onPress={go} accessibilityRole="button">
      <View style={[styles.rowIcon, { backgroundColor: c.tint }]}>
        <Feather name={icon} size={18} color={c.tintIcon} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: c.ink }]}>{title}</Text>
        <Text style={[styles.rowHint, { color: c.inkMuted }]}>{hint}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={c.inkFaint} />
    </Pressable>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScreenHeader title="Games" />
      <ScrollView contentContainerStyle={styles.content}>
        <EventBanner token={session?.token} />
        <Challenges token={session?.token} />
        <Games />
        <View style={{ gap: space.s }}>
          {link('users', 'Challenge a friend', 'The same 10 birds: who knows them best?', () => router.push('/duel'))}
          {link('bar-chart', 'This week’s leaderboard', 'XP from sightings, IDs and quizzes', () => router.push('/leaderboard'))}
          {link('award', 'Badges & streaks', 'What you’ve earned, and what’s next', () =>
            session ? router.push('/achievements') : signInFirst('Sign in to earn badges.'),
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.xl, paddingBottom: space.xxl * 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderWidth: 1, borderRadius: radius.tile, padding: space.m },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: font.bold, fontSize: 15 },
  rowHint: { fontFamily: font.medium, fontSize: 12 },
});
