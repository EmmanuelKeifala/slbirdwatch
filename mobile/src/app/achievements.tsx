import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { myAchievements, type Badge, type Streak } from '@/api';
import { useAuth } from '@/auth';
import { ScreenHeader } from '@/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

type Icon = ComponentProps<typeof Feather>['name'];
type Data = Awaited<ReturnType<typeof myAchievements>>;

/** GAM-03 badges and GAM-04 streaks. */
export default function Achievements() {
  const c = useColors();
  const token = useAuth().session?.token;
  const [data, setData] = useState<Data | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (token) myAchievements(token).then(setData, () => {});
    }, [token]),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Badges & streaks" back />
      {!data ? (
        <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.streaks}>
            <StreakCard icon="zap" title="Daily quiz" unit="day" s={data.streaks.daily_quiz} hint="Do a quiz today to keep it going" />
            <StreakCard icon="map" title="Weekly outing" unit="week" s={data.streaks.weekly_outing} hint="Log an outing this week" />
          </View>

          <Text style={[styles.h2, { color: c.ink }]}>
            Badges <Text style={{ color: c.inkMuted }}>· {data.earned} of {data.badges.length}</Text>
          </Text>
          <View style={styles.grid}>
            {[...data.badges.filter((b) => b.earned), ...data.badges.filter((b) => !b.earned)].map((b) => (
              <BadgeTile key={b.key} b={b} />
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StreakCard({ icon, title, unit, s, hint }: { icon: Icon; title: string; unit: string; s: Streak; hint: string }) {
  const c = useColors();
  const on = s.current > 0;
  return (
    <LinearGradient
      colors={on ? [c.night[0], c.night[1]] : [c.field, c.field]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.streak}
      accessible
      accessibilityLabel={`${title} streak: ${s.current} ${unit}${s.current === 1 ? '' : 's'}, best ${s.best}`}
    >
      <Feather name={icon} size={20} color={on ? '#F4B400' : c.inkFaint} />
      <Text style={[styles.streakNum, { color: on ? '#FFFFFF' : c.ink }]}>{s.current}</Text>
      <Text style={[styles.streakTitle, { color: on ? '#FFFFFF' : c.ink }]}>
        {title} · {unit}s
      </Text>
      <Text style={[styles.streakHint, { color: on ? '#C9C2FF' : c.inkMuted }]}>{on ? `Best ${s.best}` : hint}</Text>
    </LinearGradient>
  );
}

function BadgeTile({ b }: { b: Badge }) {
  const c = useColors();
  return (
    <View
      style={[styles.badge, { borderColor: b.earned ? c.accent : c.border, backgroundColor: b.earned ? c.tint : c.bg }]}
      accessible
      accessibilityLabel={`${b.name}: ${b.description}. ${b.earned ? 'Earned' : `${b.progress} of ${b.goal}`}`}
    >
      <View style={[styles.medal, { backgroundColor: b.earned ? c.accent : c.field }]}>
        <Feather name={b.icon as Icon} size={22} color={b.earned ? c.onAccent : c.inkFaint} />
      </View>
      <Text style={[styles.badgeName, { color: b.earned ? c.ink : c.inkMuted }]} numberOfLines={1}>
        {b.name}
      </Text>
      <Text style={[styles.badgeDesc, { color: c.inkMuted }]} numberOfLines={3}>
        {b.description}
      </Text>
      {!b.earned && b.goal > 1 && (
        <>
          <View style={[styles.bar, { backgroundColor: c.field }]}>
            <View style={[styles.fill, { backgroundColor: c.accent, width: `${(100 * b.progress) / b.goal}%` }]} />
          </View>
          <Text style={[styles.badgeDesc, { color: c.inkFaint }]}>
            {b.progress} / {b.goal}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.l, paddingBottom: space.xxl * 2 },
  streaks: { flexDirection: 'row', gap: space.m },
  streak: { flex: 1, borderRadius: radius.card, padding: space.l, gap: 2 },
  streakNum: { fontFamily: font.display, fontSize: 40, lineHeight: 44, marginTop: space.s },
  streakTitle: { fontFamily: font.bold, fontSize: 14 },
  streakHint: { fontFamily: font.medium, fontSize: 12 },
  h2: { fontFamily: font.display, fontSize: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m },
  badge: { width: '47%', flexGrow: 1, borderWidth: 1.5, borderRadius: radius.card, padding: space.m, gap: 4 },
  medal: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  badgeName: { fontFamily: font.bold, fontSize: 14 },
  badgeDesc: { fontFamily: font.medium, fontSize: 12, lineHeight: 16 },
  bar: { height: 6, borderRadius: radius.pill, marginTop: 4, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.pill },
});
