import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import { Pressable } from '@/Pressable';

import { mediaUrl, shownSpecies, type Observation, type Page } from '@/api';
import { BirdCard } from '@/BirdTile';
import { StaggerGrid } from '@/StaggerGrid';
import { font, space, useColors } from '@/theme';

/** Paged staggered grid of observations; tapping one opens it. Reloads when the screen regains focus. */
export function ObservationGrid({
  load,
  header,
  empty,
}: {
  load: (offset: number) => Promise<Page<Observation>>;
  header?: ReactNode;
  empty: string;
}) {
  const c = useColors();
  const [items, setItems] = useState<Observation[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false); // refreshing a list already on screen stays quiet
  const [error, setError] = useState(false);

  const fetchPage = useCallback(
    (offset: number) => {
      setLoading(true);
      setPaging(offset > 0);
      setError(false);
      return load(offset)
        .then((p) => {
          setItems((prev) => (offset === 0 ? p.items : [...prev, ...p.items]));
          setNext(p.next_offset);
        })
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    },
    [load],
  );

  useFocusEffect(
    useCallback(() => {
      fetchPage(0);
    }, [fetchPage]),
  );

  return (
    <StaggerGrid
      items={items}
      keyOf={(o) => o.id}
      header={header}
      onEndReached={() => next !== null && !loading && fetchPage(next)}
      onRefresh={() => fetchPage(0)}
      render={(o, tall) => {
        const sp = shownSpecies(o);
        return (
          <BirdCard
            id={sp?.id ?? o.id}
            title={sp?.english_name ?? 'Unknown bird'}
            caption={o.site ? `${o.site.name} · ${o.observer.display_name}` : `by ${o.observer.display_name}`}
            uri={o.photos[0] ? mediaUrl(o.photos[0].thumb_url) : undefined}
            tall={tall}
            onPress={() => router.push(`/sighting/${o.id}`)}
          />
        );
      }}
      footer={
        loading && (paging || items.length === 0) ? (
          <ActivityIndicator style={{ margin: space.xl }} color={c.accent} />
        ) : error ? (
          <Pressable onPress={() => fetchPage(0)} accessibilityRole="button">
            <Text style={[styles.muted, { color: c.wrong }]}>Couldn’t load. Tap to retry.</Text>
          </Pressable>
        ) : items.length === 0 ? (
          <Text style={[styles.muted, { color: c.inkMuted }]}>{empty}</Text>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  muted: { fontFamily: font.regular, fontSize: 15, textAlign: 'center', marginTop: space.xl },
});
