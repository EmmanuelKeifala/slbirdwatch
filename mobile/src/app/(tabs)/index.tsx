import { router } from 'expo-router';
import { useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/Pressable';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mediaUrl, type BrowseFilters } from '@/api';
import { BirdCard } from '@/BirdTile';
import { BrowseFilterBar } from '@/BrowseFilters';
import { ScreenHeader } from '@/ScreenHeader';
import { SearchField } from '@/SearchField';
import { StaggerGrid } from '@/StaggerGrid';
import { font, radius, space, useColors } from '@/theme';
import { useSpecies } from '@/useSpecies';
import { useAuth } from '@/auth';
import { useUnread } from '@/unread';

/** Home: browse and search the bird library, no account needed (ACC-01). */
export default function Explore() {
  const c = useColors();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<BrowseFilters>({});
  const { session } = useAuth();
  const unread = useUnread(session?.token);
  const { items, offline, loading, error, more, retry, refresh } = useSpecies(query, filters);
  const searching = !!query.trim() || Object.values(filters).some(Boolean);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <StaggerGrid
        collapsible={
          <>
            <ScreenHeader
              title="Bird library"
              right={
                <View style={styles.icons}>
                  <Pressable
                    onPress={() => router.push('/activity')}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel="Activity: verified sightings near you and from people you follow"
                  >
                    <Feather name="activity" size={23} color={c.ink} />
                  </Pressable>
                  {session && (
                    <Pressable
                      onPress={() => router.push('/notifications')}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
                    >
                      <Feather name="bell" size={23} color={c.ink} />
                      {unread > 0 && (
                        <View style={[styles.bellBadge, { backgroundColor: c.wrong }]}>
                          <Text style={styles.bellText}>{unread > 9 ? '9+' : unread}</Text>
                        </View>
                      )}
                    </Pressable>
                  )}
                </View>
              }
            />
            <View style={styles.pinned}>
              <Text style={[styles.hero, { color: c.ink }]} accessibilityRole="header">
                Learn the birds{'\n'}around you
              </Text>
              <SearchField value={query} onChange={setQuery} placeholder="Search by common or scientific name" />
              <View style={{ marginTop: space.m }}>
                <BrowseFilterBar value={filters} onChange={setFilters} />
              </View>
              <View style={styles.actions}>
                <Pressable
                  style={({ pressed }) => [styles.help, { backgroundColor: c.tint }, pressed && { opacity: 0.8 }]}
                  onPress={() => router.push('/checklist')}
                  accessibilityRole="button"
                >
                  <Feather name="map-pin" size={18} color={c.tintIcon} />
                  <Text style={[styles.helpText, { color: c.ink }]}>Birds around here</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.help, { backgroundColor: c.tint }, pressed && { opacity: 0.8 }]}
                  onPress={() => router.push('/identify')}
                  accessibilityRole="button"
                >
                  <Feather name="help-circle" size={18} color={c.tintIcon} />
                  <Text style={[styles.helpText, { color: c.ink }]}>Help identify</Text>
                </Pressable>
              </View>
              {offline ? (
                <View style={styles.note}>
                  <Feather name="wifi-off" size={13} color={c.accentDeep} />
                  <Text style={[styles.noteText, { color: c.inkMuted }]}>No signal: showing your offline guide</Text>
                </View>
              ) : (
                !searching && (
                  <View style={styles.note}>
                    <Feather name="map-pin" size={13} color={c.accentDeep} />
                    <Text style={[styles.noteText, { color: c.inkMuted }]}>Sierra Leone’s birds first, most seen at the top</Text>
                  </View>
                )
              )}
            </View>
          </>
        }
        items={items}
        keyOf={(b) => b.id}
        onEndReached={more}
        onRefresh={refresh}
        render={(b, tall) => (
          <BirdCard
            id={b.id}
            title={b.english_name}
            caption={searching ? b.scientific_name : b.family_en}
            uri={b.image ? mediaUrl(b.image.thumb_url) : undefined}
            tall={tall}
            onPress={() => router.push(`/species/${b.id}`)}
          />
        )}
        footer={
          error ? (
            <View style={styles.center}>
              <Text style={[styles.muted, { color: c.inkMuted }]}>Couldn’t load birds. Check your connection.</Text>
              <Pressable style={[styles.button, { backgroundColor: c.primary }]} onPress={retry} accessibilityRole="button">
                <Text style={[styles.buttonText, { color: c.onPrimary }]}>Try again</Text>
              </Pressable>
            </View>
          ) : loading ? (
            <ActivityIndicator style={{ margin: space.xl }} color={c.accent} />
          ) : searching && items.length === 0 ? (
            <Text style={[styles.muted, { color: c.inkMuted, marginTop: space.xl }]}>
              {query.trim() ? `No birds match “${query.trim()}”.` : 'No confirmed sightings match these filters yet.'}
            </Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  icons: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  bellBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  bellText: { fontFamily: font.bold, fontSize: 10, color: '#FFFFFF' },
  pinned: { paddingHorizontal: space.screen, paddingBottom: space.l },
  help: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s,
    borderRadius: radius.pill,
    paddingHorizontal: space.l,
    height: 44,
    marginTop: space.m,
  },
  helpText: { flexShrink: 1, fontFamily: font.semibold, fontSize: 14 },
  actions: { flexDirection: 'row', gap: space.s },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: space.m,
  },
  noteText: { fontFamily: font.medium, fontSize: 13 },
  hero: {
    fontFamily: font.display,
    fontSize: 32,
    lineHeight: 34,
    marginTop: space.xs,
    marginBottom: space.l,
  },
  center: { alignItems: 'center', gap: space.l, marginTop: space.xl },
  muted: { fontFamily: font.regular, fontSize: 15, textAlign: 'center' },
  button: {
    borderRadius: radius.pill,
    height: 52,
    paddingHorizontal: space.xxl,
    justifyContent: 'center',
  },
  buttonText: { fontFamily: font.semibold, fontSize: 15 },
});
