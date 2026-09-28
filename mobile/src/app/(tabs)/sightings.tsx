import { Feather } from '@expo/vector-icons';
import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/Pressable';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mediaUrl, myObservations, shownSpecies, type Observation } from '@/api';
import { useAuth } from '@/auth';
import { BirdArt } from '@/BirdArt';
import { DiscoveryCard } from '@/DiscoveryCard';
import { OutboxList } from '@/OutboxList';
import { OutingBar } from '@/OutingBar';
import { useOutbox } from '@/outbox';
import { StaggerGrid } from '@/StaggerGrid';
import { font, radius, space, useColors } from '@/theme';

/** "Your discoveries" — design/refs/screen-discoveries.png. */
export default function Sightings() {
  const c = useColors();
  const { session } = useAuth();
  const [items, setItems] = useState<Observation[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = session?.token;
  const queued = useOutbox(session?.user.id);
  const [filter, setFilter] = useState<'all' | Observation['status']>('all');

  const load = useCallback(
    async (offset: number) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const page = await myObservations(token, offset);
        setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setNext(page.next_offset);
        setTotal(page.total);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      load(0);
    }, [load]),
  );
  // An upload finished: show it in the grid.
  const waiting = queued.length;
  const prev = useRef(waiting);
  useEffect(() => {
    if (waiting < prev.current) load(0);
    prev.current = waiting;
  }, [waiting, load]);

  if (!session) {
    return (
      <SafeAreaView style={[styles.empty, { backgroundColor: c.bg }]}>
        <Text style={[styles.big, { color: c.ink }]}>Your discoveries{'\n'}live here</Text>
        <Text style={[styles.muted, { color: c.inkMuted }]}>Sign in to log the birds you see and keep them all in one place.</Text>
        <Link href="/sign-in" asChild>
          <Pressable style={[styles.button, { backgroundColor: c.primary }]} accessibilityRole="button">
            <Text style={[styles.buttonText, { color: c.onPrimary }]}>Sign in</Text>
          </Pressable>
        </Link>
      </SafeAreaView>
    );
  }

  const shownItems = filter === 'all' ? items : items.filter((o) => o.status === filter);
  const species = new Set(items.map((o) => shownSpecies(o)?.id).filter(Boolean)).size;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <StaggerGrid
        header={
          <View style={{ gap: space.l }}>
            <View style={styles.top}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: c.ink }]} accessibilityRole="header">
                  Your discoveries
                </Text>
                <Text style={[styles.sub, { color: c.inkMuted }]}>
                  {total + queued.length} sighting{total + queued.length === 1 ? '' : 's'}
                  {species ? ` · ${species} species` : ''}
                </Text>
              </View>
              <Pressable
                style={[styles.add, { backgroundColor: c.primary }]}
                onPress={() => router.push('/observe')}
                accessibilityRole="button"
                accessibilityLabel="Log a bird"
              >
                <Feather name="plus" size={16} color={c.onPrimary} />
                <Text style={[styles.addText, { color: c.onPrimary }]}>Log a bird</Text>
              </Pressable>
            </View>

            <OutingBar />
            <OutboxList items={queued} />

            {items.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
                {FILTERS.map((f) => {
                  const on = f.key === filter;
                  const n = f.key === 'all' ? items.length : items.filter((o) => o.status === f.key).length;
                  return (
                    <Pressable
                      key={f.key}
                      onPress={() => setFilter(f.key)}
                      style={[styles.filter, { backgroundColor: on ? c.primary : c.field }]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.filterText, { color: on ? c.onPrimary : c.ink }]}>
                        {f.label} <Text style={{ color: on ? '#C9C2FF' : c.inkMuted }}>{n}</Text>
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <View />
          </View>
        }
        items={shownItems}
        keyOf={(o) => o.id}
        onEndReached={() => next !== null && !loading && load(next)}
        render={(o, tall) => (
          <DiscoveryCard
            tileId={shownSpecies(o)?.id ?? o.id}
            title={shownSpecies(o)?.english_name ?? 'Unknown bird'}
            caption={[
              o.site?.name,
              new Date(o.observed_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
            ]
              .filter(Boolean)
              .join(' · ')}
            uri={
              o.photos[0]
                ? mediaUrl(o.photos[0].thumb_url)
                : o.species?.thumb_url
                  ? mediaUrl(o.species.thumb_url)
                  : undefined
            }
            status={o.status}
            tall={tall}
            onPress={() => router.push(`/sighting/${o.id}`)}
          />
        )}
        footer={
          loading ? (
            <ActivityIndicator style={{ margin: space.xl }} color={c.accent} />
          ) : error ? (
            <Pressable onPress={() => load(0)} accessibilityRole="button">
              <Text style={[styles.muted, { color: c.wrong, marginTop: space.xl }]}>Couldn’t load your sightings. Tap to retry.</Text>
            </Pressable>
          ) : items.length === 0 && queued.length === 0 ? (
            <View style={styles.emptyGrid}>
              <BirdArt id={5} size={150} />
              <Text style={[styles.emptyTitle, { color: c.ink }]}>Your first bird is out there</Text>
              <Text style={[styles.muted, { color: c.inkMuted }]}>Log what you see, even if you don’t know what it is yet.</Text>
            </View>
          ) : shownItems.length === 0 ? (
            <Text style={[styles.muted, { color: c.inkMuted, marginTop: space.xl }]}>Nothing here with this status yet.</Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const FILTERS: { key: 'all' | Observation['status']; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'needs_id', label: 'Needs ID' },
  { key: 'community', label: 'Community ID' },
  { key: 'verified', label: 'Verified' },
];

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.l },
  big: { fontFamily: font.display, fontSize: 34, lineHeight: 36, textAlign: 'center' },
  muted: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  button: { borderRadius: radius.pill, height: 56, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: font.semibold, fontSize: 16 },
  top: { flexDirection: 'row', alignItems: 'flex-end', gap: space.m, marginTop: space.l },
  title: { fontFamily: font.display, fontSize: 34, lineHeight: 38 },
  sub: { fontFamily: font.semibold, fontSize: 14, marginTop: 2 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, borderRadius: radius.pill, paddingHorizontal: space.l },
  addText: { fontFamily: font.semibold, fontSize: 14 },
  filter: { borderRadius: radius.pill, paddingHorizontal: space.l, height: 36, justifyContent: 'center' },
  filterText: { fontFamily: font.semibold, fontSize: 13 },
  emptyGrid: { alignItems: 'center', gap: space.m, marginTop: space.xl, paddingHorizontal: space.l },
  emptyTitle: { fontFamily: font.display, fontSize: 24, textAlign: 'center' },
});
