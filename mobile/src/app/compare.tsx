import { Feather } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormScroll } from '@/components/FormScroll';
import { compareSpecies, mediaUrl, type CompareItem, type SoundRecording } from '@/api';
import { BirdArt } from '@/components/BirdArt';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { seasonText } from '@/lib/season';
import { SpeciesPicker } from '@/components/SpeciesPicker';
import { font, radius, space, tileFor, useColors } from '@/theme';

const VARIANT = { male: 'Male', female: 'Female', juvenile: 'Young', adult: 'Adult', '': '' } as const;

/**
 * LRN-01: 2–4 lookalikes side by side, row by row so each detail lines up. Field marks only one of them shows
 * (from confirmed community sightings) are highlighted: those are the differences to look for.
 */
export default function Compare() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ ids: string }>();
  const [ids, setIds] = useState(() => (params.ids ?? '').split(',').map(Number).filter(Boolean).slice(0, 4));
  const key = ids.join(',');
  const [result, setResult] = useState<{ key: string; items?: CompareItem[]; error?: string } | null>(null);

  useEffect(() => {
    if (ids.length < 2) return;
    compareSpecies(ids)
      .then((r) => setResult({ key, items: r.items }))
      .catch((e) => setResult({ key, error: e instanceof Error ? e.message : String(e) }));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = result?.key === key ? (result.items ?? null) : null; // stale results don't show while loading
  const error = ids.length < 2 ? 'Pick at least two birds to compare.' : result?.key === key ? (result.error ?? null) : null;

  const col = ids.length <= 2 ? (width - space.screen * 2 - space.m) / 2 : 168;

  const row = (label: string, cell: (it: CompareItem) => ReactNode) => (
    <View key={label} style={styles.rowBlock}>
      <Text style={[styles.rowLabel, { color: c.inkMuted }]}>{label}</Text>
      <View style={styles.row}>
        {items!.map((it) => (
          <View key={it.id} style={{ width: col }}>
            {cell(it)}
          </View>
        ))}
      </View>
    </View>
  );
  const text = (t: string, empty: string) => (
    <Text style={[styles.body, { color: t ? c.ink : c.inkFaint }]} numberOfLines={7}>
      {t || empty}
    </Text>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Compare" back />
      {error ? (
        <Text style={[styles.body, { color: c.wrong, padding: space.screen }]}>{error}</Text>
      ) : !items ? (
        <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
      ) : (
        <FormScroll contentContainerStyle={{ paddingBottom: space.xxl * 2 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={ids.length > 2} contentContainerStyle={styles.table}>
            <View>
              <View style={styles.row}>
                {items.map((it) => (
                  <View key={it.id} style={{ width: col, gap: space.s }}>
                    <Pressable onPress={() => router.push(`/species/${it.id}`)} accessibilityRole="button">
                      <View style={[styles.photo, { width: col, height: col, backgroundColor: tileFor(c, it.id) }]}>
                        {it.image ? (
                          <Image source={{ uri: mediaUrl(it.image) }} style={StyleSheet.absoluteFill} />
                        ) : (
                          <BirdArt id={it.id} size={col * 0.8} />
                        )}
                      </View>
                    </Pressable>
                    <View style={styles.nameRow}>
                      <Text style={[styles.name, { color: c.ink }]} numberOfLines={2}>
                        {it.english_name}
                      </Text>
                      {ids.length > 2 && (
                        <Pressable
                          onPress={() => setIds(ids.filter((x) => x !== it.id))}
                          hitSlop={10}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${it.english_name}`}
                        >
                          <Feather name="x" size={16} color={c.inkMuted} />
                        </Pressable>
                      )}
                    </View>
                    <Text style={[styles.sci, { color: c.inkMuted }]} numberOfLines={1}>
                      {it.scientific_name}
                    </Text>
                  </View>
                ))}
              </View>

              {row('Size', (it) => text(it.length, 'Not known'))}
              {row('In Sierra Leone', (it) => {
                const s = it.months ? seasonText(it.months) : null;
                return text(s ? `${s.title} · ${s.caption}` : '', 'Not recorded');
              })}
              {row('Listen', (it) => (it.sound ? <Play sound={it.sound} /> : text('', 'No recording yet')))}
              {row('Male, female, young', (it) =>
                it.variants.length ? (
                  <View style={styles.variants}>
                    {it.variants.map((v) => (
                      <View key={v.url} style={{ alignItems: 'center', gap: 2 }}>
                        <Image source={{ uri: mediaUrl(v.thumb_url) }} style={styles.variant} accessibilityLabel={VARIANT[v.variant]} />
                        <Text style={[styles.tiny, { color: c.inkMuted }]}>{VARIANT[v.variant]}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  text('', 'No tagged photos yet')
                ),
              )}
              {row('Field marks', (it) =>
                it.marks.length ? (
                  <View style={styles.chips}>
                    {it.marks.map((m) => (
                      <View
                        key={m.key + m.label}
                        style={[styles.chip, { backgroundColor: m.unique ? c.accent : c.field }]}
                        accessibilityLabel={m.unique ? `${m.label}, only this bird` : m.label}
                      >
                        {m.unique && <Feather name="star" size={10} color={c.onAccent} />}
                        <Text style={[styles.chipText, { color: m.unique ? c.onAccent : c.ink }]}>{m.label}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  text('', 'No confirmed sightings with field marks yet')
                ),
              )}
              {row('Males and females', (it) => text(it.sexes, 'No notes'))}
              {row('Voice', (it) => text(it.voice, 'No notes'))}
            </View>
          </ScrollView>

          <View style={styles.after}>
            {items.some((it) => it.marks.some((m) => m.unique)) && (
              <View style={styles.legend}>
                <View style={[styles.chip, { backgroundColor: c.accent }]}>
                  <Feather name="star" size={10} color={c.onAccent} />
                  <Text style={[styles.chipText, { color: c.onAccent }]}>Mark</Text>
                </View>
                <Text style={[styles.tiny, { color: c.inkMuted, flex: 1 }]}>
                  Only this bird shows it in confirmed community sightings: a difference to look for.
                </Text>
              </View>
            )}
            {ids.length < 4 && (
              <>
                <Text style={[styles.rowLabel, { color: c.inkMuted }]}>Add a bird</Text>
                <SpeciesPicker value={undefined} onChange={(p) => p && !ids.includes(p.id) && setIds([...ids, p.id])} />
              </>
            )}
          </View>
        </FormScroll>
      )}
    </SafeAreaView>
  );
}

function Play({ sound }: { sound: SoundRecording }) {
  const c = useColors();
  const player = useAudioPlayer(mediaUrl(sound.url));
  const status = useAudioPlayerStatus(player);
  const toggle = () => {
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish || status.currentTime >= status.duration - 0.2) player.seekTo(0);
      player.play();
    }
  };
  return (
    <Pressable style={styles.play} onPress={toggle} accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause' : 'Play'}>
      <View style={[styles.playButton, { backgroundColor: c.primary }]}>
        <Feather name={status.playing ? 'pause' : 'play'} size={16} color={c.onPrimary} />
      </View>
      <Text style={[styles.tiny, { color: c.inkMuted, flex: 1 }]} numberOfLines={2}>
        {sound.kind === 'song' ? 'Song' : 'Call'} · {sound.credit}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  table: { paddingHorizontal: space.screen, paddingTop: space.s },
  row: { flexDirection: 'row', gap: space.m },
  rowBlock: { marginTop: space.l, gap: space.s },
  rowLabel: { fontFamily: font.bold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  photo: { borderRadius: radius.tile, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  name: { flex: 1, fontFamily: font.display, fontSize: 18, lineHeight: 21 },
  sci: { fontFamily: font.italic, fontSize: 12, marginTop: -4 },
  body: { fontFamily: font.regular, fontSize: 13, lineHeight: 19 },
  tiny: { fontFamily: font.medium, fontSize: 11 },
  variants: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  variant: { width: 46, height: 46, borderRadius: radius.chip },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontFamily: font.semibold, fontSize: 11 },
  play: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  playButton: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  after: { paddingHorizontal: space.screen, marginTop: space.xl, gap: space.m },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.s },
});
