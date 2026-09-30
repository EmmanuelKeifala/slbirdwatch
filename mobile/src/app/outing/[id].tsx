import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getOuting, type OutingSummary } from '@/api';
import { useAuth } from '@/state/auth';
import { duration, km } from '@/lib/outingMath';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StaticMap } from '@/components/StaticMap';
import { font, radius, space, useColors } from '@/theme';

/** OBS-10: an outing's summary — time, distance, route, and what was seen. */
export default function Outing() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuth().session?.token;
  const [o, setO] = useState<OutingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) getOuting(token, Number(id)).then(setO, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id, token]);

  const day = o ? new Date(o.started_at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : '';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Outing" back />
      {!o ? (
        error ? (
          <Text style={[styles.body, { color: c.wrong, padding: space.screen }]}>Couldn’t load this outing.</Text>
        ) : (
          <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
        )
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.title, { color: c.ink }]}>{day}</Text>
          <Text style={[styles.body, { color: c.inkMuted }]}>
            {new Date(o.started_at).toLocaleTimeString(undefined, { timeStyle: 'short' })}
            {o.ended_at ? ` – ${new Date(o.ended_at).toLocaleTimeString(undefined, { timeStyle: 'short' })}` : ' · still going'}
          </Text>

          <View style={styles.tiles}>
            {[
              { v: duration(o.minutes), l: 'Time', t: c.tiles[0] },
              { v: km(o.distance_m), l: 'Walked', t: c.tiles[1] },
              { v: String(o.species.length), l: 'Species', t: c.tiles[4] },
              { v: String(o.sightings), l: 'Sightings', t: c.tiles[3] },
            ].map((x) => (
              <View key={x.l} style={[styles.tile, { backgroundColor: x.t }]}>
                <Text style={[styles.tileValue, { color: c.ink }]}>{x.v}</Text>
                <Text style={[styles.tileLabel, { color: c.inkMuted }]}>{x.l}</Text>
              </View>
            ))}
          </View>

          {o.route.length >= 2 ? (
            <StaticMap route={o.route} label="Map of the outing's route" title={`Route · ${day}`} />
          ) : (
            <Text style={[styles.body, { color: c.inkFaint }]}>No route was recorded.</Text>
          )}

          <Text style={[styles.h2, { color: c.ink }]}>What you saw</Text>
          {o.species.length === 0 ? (
            <Text style={[styles.body, { color: c.inkMuted }]}>
              {o.sightings ? 'Sightings of unknown birds only, so far.' : 'No sightings were logged on this outing.'}
            </Text>
          ) : (
            o.species.map((sp) => (
              <Pressable
                key={sp.id}
                style={[styles.row, { borderColor: c.border }]}
                onPress={() => router.push(`/species/${sp.id}`)}
                accessibilityRole="button"
              >
                <Text style={[styles.name, { color: c.ink }]}>{sp.english_name}</Text>
                <Text style={[styles.count, { color: c.inkMuted }]}>× {sp.count}</Text>
                <Feather name="chevron-right" size={18} color={c.inkFaint} />
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
  title: { fontFamily: font.display, fontSize: 30, lineHeight: 34 },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  tile: { width: '48%', flexGrow: 1, borderRadius: radius.tile, padding: space.l, gap: 2 },
  tileValue: { fontFamily: font.display, fontSize: 24 },
  tileLabel: { fontFamily: font.semibold, fontSize: 12 },
  h2: { fontFamily: font.display, fontSize: 22, marginTop: space.l },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderWidth: 1.5, borderRadius: radius.tile, padding: space.l },
  name: { flex: 1, fontFamily: font.semibold, fontSize: 15 },
  count: { fontFamily: font.semibold, fontSize: 14 },
});
