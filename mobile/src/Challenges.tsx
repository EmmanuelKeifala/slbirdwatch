import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { weekChallenges, type Challenge } from '@/api';
import { signInFirst } from '@/nav';
import { Pressable } from '@/Pressable';
import { font, radius, space, useColors } from '@/theme';

type Icon = ComponentProps<typeof Feather>['name'];
const ICON: Record<string, Icon> = {
  family_photo: 'camera',
  dawn_song: 'mic',
  new_site: 'compass',
  species_week: 'feather',
  quiz_days: 'zap',
  help_ids: 'users',
};
// where each challenge is done
const GO: Record<string, () => void> = {
  family_photo: () => router.push('/observe'),
  dawn_song: () => router.push('/observe'),
  new_site: () => router.push('/observe'),
  species_week: () => router.push('/observe'),
  quiz_days: () => router.push('/quiz'),
  help_ids: () => router.push('/identify'),
};

/** GAM-01: this week's three challenges, with progress, on the Learn tab. */
export function Challenges({ token }: { token?: string }) {
  const c = useColors();
  const [data, setData] = useState<{ items: Challenge[]; ends: string; xp: number } | null>(null);
  const [now, setNow] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      weekChallenges(token).then(setData, () => {});
    }, [token]),
  );
  if (!data?.items.length) return null;
  const days = Math.max(1, Math.ceil((new Date(data.ends).getTime() - now) / 86400000));

  return (
    <View style={{ gap: space.m }}>
      <View style={styles.head}>
        <Text style={[styles.h2, { color: c.ink }]}>This week’s challenges</Text>
        <Text style={[styles.left, { color: c.inkMuted }]}>
          {days} day{days === 1 ? '' : 's'} left
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.m }} style={styles.bleed}>
        {data.items.map((ch) => (
          <Pressable
            key={ch.id}
            style={[styles.card, { backgroundColor: ch.done ? c.tint : c.surface, borderColor: ch.done ? c.accent : c.border }]}
            onPress={() => (token ? GO[ch.kind]?.() : signInFirst('Sign in to take part in challenges.'))}
            accessibilityRole="button"
            accessibilityLabel={`${ch.title}. ${ch.description} ${ch.done ? 'Done' : `${ch.progress} of ${ch.goal}`}`}
          >
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: ch.done ? c.accent : c.field }]}>
                <Feather name={ch.done ? 'check' : (ICON[ch.kind] ?? 'flag')} size={18} color={ch.done ? c.onAccent : c.accentDeep} />
              </View>
              <Text style={[styles.xp, { color: c.accentDeep }]}>+{data.xp} XP</Text>
            </View>
            <Text style={[styles.title, { color: c.ink }]} numberOfLines={2}>
              {ch.title}
            </Text>
            <Text style={[styles.desc, { color: c.inkMuted }]} numberOfLines={3}>
              {ch.description}
            </Text>
            <View style={[styles.bar, { backgroundColor: c.field }]}>
              <View style={[styles.fill, { backgroundColor: ch.done ? c.correct : c.accent, width: `${(100 * ch.progress) / ch.goal}%` }]} />
            </View>
            <Text style={[styles.desc, { color: ch.done ? c.correct : c.inkFaint }]}>
              {ch.done ? 'Done!' : token ? `${ch.progress} / ${ch.goal}` : 'Sign in to take part'}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={[styles.note, { color: c.inkFaint }]}>Sightings count once the community agrees on the ID.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  h2: { fontFamily: font.display, fontSize: 22 },
  left: { fontFamily: font.semibold, fontSize: 12 },
  bleed: { marginHorizontal: -space.screen, paddingHorizontal: space.screen },
  card: { width: 200, borderWidth: 1.5, borderRadius: radius.card, padding: space.m, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  xp: { fontFamily: font.bold, fontSize: 12 },
  title: { fontFamily: font.bold, fontSize: 15, lineHeight: 19 },
  desc: { fontFamily: font.medium, fontSize: 12, lineHeight: 16 },
  bar: { height: 6, borderRadius: radius.pill, overflow: 'hidden', marginTop: 2 },
  fill: { height: 6, borderRadius: radius.pill },
  note: { fontFamily: font.medium, fontSize: 11 },
});
