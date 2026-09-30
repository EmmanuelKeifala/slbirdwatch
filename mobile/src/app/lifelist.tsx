import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { learnNext, lifeList, mediaUrl, type LifeBird, type NextBird } from '@/api';
import { useAuth } from '@/state/auth';
import { BirdCard } from '@/components/BirdTile';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { font, radius, space, tileFor, useColors } from '@/theme';

/** LRN-05: the birds you've seen (verified sightings), those awaiting confirmation, and birds to learn next. */
export default function LifeList() {
  const c = useColors();
  const token = useAuth().session?.token;
  const [list, setList] = useState<LifeBird[] | null>(null);
  const [next, setNext] = useState<NextBird[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      lifeList(token).then((r) => setList(r.items), () => setList([]));
      learnNext(token).then((r) => setNext(r.items), () => {});
    }, [token]),
  );

  const seen = (list ?? []).filter((b) => b.verified);
  const waiting = (list ?? []).filter((b) => !b.verified);
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Life list" back />
      {list === null ? (
        <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.hero, { backgroundColor: c.tiles[1] }]}>
            <Text style={[styles.count, { color: c.ink }]}>{seen.length}</Text>
            <Text style={[styles.countLabel, { color: c.ink }]}>species seen</Text>
            <Text style={[styles.hint, { color: c.inkMuted }]}>
              {waiting.length
                ? `${waiting.length} more awaiting confirmation`
                : seen.length
                  ? 'Every one confirmed by the community'
                  : 'Your list grows as your sightings are verified'}
            </Text>
          </View>

          {seen.length > 0 && (
            <View style={styles.grid}>
              {seen.map((b) => (
                <View key={b.id} style={styles.cell}>
                  <BirdCard
                    id={b.id}
                    title={b.english_name}
                    caption={`First ${day(b.first_seen)}${b.sightings > 1 ? ` · ${b.sightings}×` : ''}`}
                    uri={b.thumb_url ? mediaUrl(b.thumb_url) : undefined}
                    onPress={() => router.push(`/species/${b.id}`)}
                  />
                </View>
              ))}
            </View>
          )}

          {waiting.length > 0 && (
            <>
              <Text style={[styles.h2, { color: c.ink }]}>Awaiting confirmation</Text>
              <View style={styles.chips}>
                {waiting.map((b) => (
                  <Pressable
                    key={b.id}
                    style={[styles.chip, { backgroundColor: c.field }]}
                    onPress={() => router.push(`/species/${b.id}`)}
                    accessibilityRole="button"
                  >
                    <Feather name="clock" size={12} color={c.inkMuted} />
                    <Text style={[styles.chipText, { color: c.ink }]}>{b.english_name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {next.length > 0 && (
            <>
              <Text style={[styles.h2, { color: c.ink }]}>Birds to learn next</Text>
              <Text style={[styles.hint, { color: c.inkMuted }]}>Common around Sierra Leone and not on your list yet.</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.m }} style={styles.bleed}>
                {next.map((b) => (
                  <Pressable key={b.id} style={styles.next} onPress={() => router.push(`/species/${b.id}`)} accessibilityRole="button">
                    <View style={[styles.nextImg, { backgroundColor: tileFor(c, b.id) }]}>
                      {b.thumb_url && <Image source={{ uri: mediaUrl(b.thumb_url) }} style={StyleSheet.absoluteFill} />}
                      {b.out_there_now && (
                        <View style={[styles.now, { backgroundColor: c.correct }]}>
                          <Text style={styles.nowText}>Out there now</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.nextName, { color: c.ink }]} numberOfLines={2}>
                      {b.english_name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable
                style={[styles.quiz, { backgroundColor: c.primary }]}
                onPress={() => router.push({ pathname: '/quiz', params: { species: next.map((b) => b.id).join(',') } })}
                accessibilityRole="button"
              >
                <Feather name="zap" size={16} color={c.onPrimary} />
                <Text style={[styles.quizText, { color: c.onPrimary }]}>Quiz me on these</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
  hero: { borderRadius: radius.card, padding: space.xl, alignItems: 'center', gap: 2 },
  count: { fontFamily: font.display, fontSize: 64, lineHeight: 68 },
  countLabel: { fontFamily: font.bold, fontSize: 16 },
  hint: { fontFamily: font.medium, fontSize: 13, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m },
  cell: { width: '47.5%' },
  h2: { fontFamily: font.display, fontSize: 22, marginTop: space.l },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 6 },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  bleed: { marginHorizontal: -space.screen, paddingHorizontal: space.screen },
  next: { width: 130, gap: 6 },
  nextImg: { height: 130, borderRadius: radius.tile, overflow: 'hidden' },
  now: { position: 'absolute', top: 6, left: 6, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  nowText: { fontFamily: font.bold, fontSize: 10, color: '#FFFFFF' },
  nextName: { fontFamily: font.bold, fontSize: 13, lineHeight: 17 },
  quiz: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 50, borderRadius: radius.pill, marginTop: space.s },
  quizText: { fontFamily: font.semibold, fontSize: 15 },
});
