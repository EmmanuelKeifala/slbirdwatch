import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getEvent } from '@/api';
import { useAuth } from '@/auth';
import { whenText } from '@/EventBanner';
import { Pressable } from '@/Pressable';
import { ScreenHeader } from '@/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

type Data = Awaited<ReturnType<typeof getEvent>>;

/** GAM-06: one seasonal event: the shared count, top counters and every species seen so far. */
export default function EventScreen() {
  const c = useColors();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { session } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      getEvent(slug, session?.token).then(setData, () => setError(true));
    }, [slug, session?.token]),
  );

  if (!data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <ScreenHeader title="Event" back />
        {error ? (
          <Text style={[styles.body, { color: c.inkMuted, padding: space.screen }]}>Couldn’t load this event.</Text>
        ) : (
          <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
        )}
      </SafeAreaView>
    );
  }
  const e = data.event;
  const started = now >= new Date(e.starts_at).getTime();
  const open = started && now < new Date(e.ends_at).getTime();
  const range = `${new Date(e.starts_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}${
    new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime() > 86400000
      ? ` – ${new Date(new Date(e.ends_at).getTime() - 1).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`
      : `, ${new Date(e.starts_at).getFullYear()}`
  }`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Event" back />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.kicker, { color: c.accentDeep }]}>{whenText(e, now).toUpperCase()}</Text>
        <Text style={[styles.title, { color: c.ink }]}>{e.title}</Text>
        <Text style={[styles.meta, { color: c.inkMuted }]}>{range}</Text>
        <Text style={[styles.body, { color: c.ink }]}>{e.description}</Text>

        <View style={styles.stats}>
          {[
            { v: e.species, l: 'species' },
            { v: e.sightings, l: 'sightings' },
            { v: e.people, l: 'birders' },
            ...(e.mine !== null ? [{ v: e.mine, l: 'yours' }] : []),
          ].map((s) => (
            <View key={s.l} style={[styles.stat, { borderColor: c.border }]}>
              <Text style={[styles.statValue, { color: c.ink }]}>{s.v}</Text>
              <Text style={[styles.meta, { color: c.inkMuted }]}>{s.l}</Text>
            </View>
          ))}
        </View>
        {open && (
          <Pressable
            style={[styles.primary, { backgroundColor: c.primary }]}
            onPress={() => router.push(session ? '/observe' : '/sign-in')}
            accessibilityRole="button"
          >
            <Feather name="plus" size={18} color={c.onPrimary} />
            <Text style={[styles.primaryText, { color: c.onPrimary }]}>{session ? 'Log a sighting' : 'Sign in to take part'}</Text>
          </Pressable>
        )}
        <Text style={[styles.meta, { color: c.inkFaint }]}>Sightings seen during the event count once the community agrees on the ID.</Text>

        {data.top.length > 0 && (
          <>
            <Text style={[styles.h2, { color: c.ink }]}>Top counters</Text>
            {data.top.map((t, i) => (
              <View key={t.user.id} style={[styles.row, { borderColor: c.border }]}>
                <Text style={[styles.rank, { color: c.inkMuted }]}>{i + 1}</Text>
                <Text style={[styles.name, { color: c.ink }]} numberOfLines={1}>
                  {t.user.display_name}
                </Text>
                <Text style={[styles.statValue, { color: c.ink, fontSize: 16 }]}>{t.species}</Text>
              </View>
            ))}
          </>
        )}
        {data.species_list.length > 0 && (
          <>
            <Text style={[styles.h2, { color: c.ink }]}>Seen so far</Text>
            <View style={styles.wrap}>
              {data.species_list.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => router.push(`/species/${s.id}`)}
                  style={[styles.chip, { backgroundColor: c.field }]}
                  accessibilityRole="link"
                >
                  <Text style={[styles.chipText, { color: c.ink }]}>{s.english_name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {!started && (
          <Text style={[styles.meta, { color: c.inkMuted }]}>We’ll remind you on the morning it starts (Profile → Notifications).</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
  kicker: { fontFamily: font.bold, fontSize: 12, letterSpacing: 1 },
  title: { fontFamily: font.display, fontSize: 32, lineHeight: 36 },
  meta: { fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  stat: { flexGrow: 1, minWidth: '22%', borderWidth: 1, borderRadius: radius.tile, padding: space.m, alignItems: 'center' },
  statValue: { fontFamily: font.display, fontSize: 24 },
  primary: { flexDirection: 'row', gap: space.s, height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: font.semibold, fontSize: 15 },
  h2: { fontFamily: font.display, fontSize: 20, marginTop: space.m },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderBottomWidth: 1, paddingVertical: space.s },
  rank: { fontFamily: font.bold, fontSize: 14, width: 22 },
  name: { flex: 1, fontFamily: font.semibold, fontSize: 15 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 7 },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
});
