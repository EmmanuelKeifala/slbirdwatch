import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { areaChecklist, lifeList, mediaUrl, type AreaBird } from '@/api';
import { useAuth } from '@/auth';
import { Pressable } from '@/Pressable';
import { ScreenHeader } from '@/ScreenHeader';
import { font, radius, space, tileFor, useColors } from '@/theme';
import { roughPosition } from '@/location';

const FREETOWN = { lat: 8.484, lng: -13.234 };
const RADII = [2, 5, 10, 25, 50];
const RARITY = { common: 'Common here', uncommon: 'Uncommon', rare: 'Rare here' } as const;
type Filter = 'all' | AreaBird['rarity'] | 'new';

/** LIB-13: the birds recorded around you, how common each is here, and which you haven't seen yet. */
export default function Checklist() {
  const c = useColors();
  const token = useAuth().session?.token;
  const [spot, setSpot] = useState<{ lat: number; lng: number; mine: boolean } | null>(null);
  const [km, setKm] = useState(10);
  // results and errors carry the query they answer, so a new radius shows the spinner without resetting state
  const [res, setRes] = useState<{ q: string; items?: AreaBird[]; gbif_ok?: boolean; error?: string } | null>(null);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    (async () => {
      try {
        if (!(await Location.requestForegroundPermissionsAsync()).granted) throw new Error();
        const pos = await roughPosition();
        setSpot({ lat: pos.coords.latitude, lng: pos.coords.longitude, mine: true });
      } catch {
        setSpot({ ...FREETOWN, mine: false }); // no location: show Freetown rather than nothing
      }
    })();
    if (token) lifeList(token).then((r) => setSeen(new Set(r.items.map((b) => b.id))), () => {});
  }, [token]);

  useEffect(() => {
    if (!spot) return;
    let live = true;
    const q = `${spot.lat},${spot.lng},${km}`;
    areaChecklist(spot.lat, spot.lng, km, token).then(
      (r) => live && setRes({ q, ...r }),
      (e) => live && setRes({ q, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [spot, km, token]);

  const current = res && spot && res.q === `${spot.lat},${spot.lng},${km}` ? res : null;
  const data = current?.items ? { items: current.items, gbif_ok: !!current.gbif_ok } : null;
  const error = current?.error ?? null;
  const items = data?.items ?? [];
  const count = (f: Filter) => items.filter((b) => (f === 'all' ? true : f === 'new' ? !seen.has(b.id) : b.rarity === f)).length;
  const shown = items.filter((b) => (filter === 'all' ? true : filter === 'new' ? !seen.has(b.id) : b.rarity === filter));
  const tone = (r: AreaBird['rarity']) => (r === 'common' ? c.correct : r === 'uncommon' ? c.rare : c.wrong);
  const filters: { f: Filter; label: string }[] = [
    { f: 'all', label: 'All' },
    { f: 'common', label: 'Common' },
    { f: 'uncommon', label: 'Uncommon' },
    { f: 'rare', label: 'Rare' },
    ...(token ? [{ f: 'new' as Filter, label: 'Not seen by me' }] : []),
  ];

  const header = (
    <View style={{ gap: space.m, paddingBottom: space.m }}>
      <Text style={[styles.hero, { color: c.ink }]}>
        {data ? `${items.length} birds` : 'Birds'} recorded{'\n'}within {km} km
      </Text>
      <View style={styles.where}>
        <Feather name="map-pin" size={13} color={c.accentDeep} />
        <Text style={[styles.whereText, { color: c.inkMuted }]}>
          {spot?.mine ? 'Around you' : 'Around Freetown (allow location to use where you are)'}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
        {RADII.map((r) => (
          <Pressable
            key={r}
            onPress={() => setKm(r)}
            style={[styles.chip, { backgroundColor: r === km ? c.primary : c.field }]}
            accessibilityRole="button"
            accessibilityState={{ selected: r === km }}
          >
            <Text style={[styles.chipText, { color: r === km ? c.onPrimary : c.ink }]}>{r} km</Text>
          </Pressable>
        ))}
      </ScrollView>
      {data && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
          {filters.map(({ f, label }) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.chip, { backgroundColor: f === filter ? c.accent : c.field }]}
              accessibilityRole="button"
              accessibilityState={{ selected: f === filter }}
            >
              <Text style={[styles.chipText, { color: f === filter ? c.onAccent : c.ink }]}>
                {label} · {count(f)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {data && !data.gbif_ok && (
        <Text style={[styles.small, { color: c.wrong }]}>GBIF couldn’t be reached, so this shows community sightings only.</Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Area checklist" back />
      <FlatList
        data={shown}
        keyExtractor={(b) => String(b.id)}
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        ListEmptyComponent={
          error ? (
            <Text style={[styles.small, { color: c.wrong }]}>{error}</Text>
          ) : !data ? (
            <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
          ) : (
            <Text style={[styles.small, { color: c.inkMuted }]}>
              {filter === 'new' ? 'You’ve seen every bird on this list. Try a bigger area.' : 'Nothing recorded here yet. Try a bigger area.'}
            </Text>
          )
        }
        ListFooterComponent={
          data ? (
            <Text style={[styles.small, { color: c.inkFaint, marginTop: space.l }]}>
              Records: GBIF.org and community sightings with an agreed ID. How common a bird is here compares its records with the
              area’s most-recorded bird. Sensitive birds are left out.
            </Text>
          ) : null
        }
        renderItem={({ item: b }) => (
          <Pressable
            style={[styles.row, { borderColor: c.border }]}
            onPress={() => router.push(`/species/${b.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${b.english_name}, ${RARITY[b.rarity]}${seen.has(b.id) ? ', on your life list' : ''}`}
          >
            <View style={[styles.thumb, { backgroundColor: tileFor(c, b.id) }]}>
              {b.image && <Image source={{ uri: mediaUrl(b.image.thumb_url) }} style={StyleSheet.absoluteFill} />}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.name, { color: c.ink }]} numberOfLines={1}>
                {b.english_name}
              </Text>
              <Text style={[styles.small, { color: c.inkMuted }]} numberOfLines={1}>
                {b.gbif + b.community} records{b.community ? ` · ${b.community} in this app` : ''}
              </Text>
              <View style={styles.tags}>
                <View style={[styles.pill, { borderColor: tone(b.rarity) }]}>
                  <View style={[styles.dot, { backgroundColor: tone(b.rarity) }]} />
                  <Text style={[styles.pillText, { color: c.ink }]}>{RARITY[b.rarity]}</Text>
                </View>
                {seen.has(b.id) && (
                  <Text style={[styles.pillText, { color: c.correct }]}>
                    <Feather name="check" size={12} /> Seen
                  </Text>
                )}
              </View>
            </View>
            <Feather name="chevron-right" size={18} color={c.inkFaint} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, paddingBottom: space.xxl * 2, gap: space.s },
  hero: { fontFamily: font.display, fontSize: 30, lineHeight: 34 },
  where: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  whereText: { fontFamily: font.medium, fontSize: 13 },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.m, height: 34, justifyContent: 'center' },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderWidth: 1, borderRadius: radius.tile, padding: space.s },
  thumb: { width: 64, height: 64, borderRadius: radius.chip, overflow: 'hidden' },
  name: { fontFamily: font.bold, fontSize: 15 },
  small: { fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: space.m, marginTop: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontFamily: font.semibold, fontSize: 11 },
});
