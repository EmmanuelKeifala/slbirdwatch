import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { familiesOf } from '@/api';
import { useAuth } from '@/state/auth';
import { Pressable } from '@/components/Pressable';
import { useQuizStats } from '@/state/quizStore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { accuracy, mastered } from '@/lib/stats';
import { font, radius, space, useColors } from '@/theme';

const pct = ([r, w]: [number, number]) => (r + w ? Math.round((100 * r) / (r + w)) : 0);

/** LRN-06: how your eye (and ear) is coming along — mastered birds, sight vs sound, accuracy by family. */
export default function Progress() {
  const c = useColors();
  const stats = useQuizStats(useAuth().session?.token);
  const [names, setNames] = useState<Record<string, { family: string; name: string }>>({});
  const bySpecies = stats.bySpecies ?? {};
  const ids = Object.keys(bySpecies);
  const key = ids.join(',');

  useEffect(() => {
    if (ids.length) familiesOf(ids).then(setNames, () => {});
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const master = ids.filter((id) => mastered(bySpecies[id]));
  const learning = ids.filter((id) => !mastered(bySpecies[id]));
  const practise = [...learning].sort((a, b) => bySpecies[b][1] - bySpecies[a][1]).slice(0, 12);

  const families: Record<string, [number, number]> = {};
  for (const id of ids) {
    const f = names[id]?.family;
    if (!f) continue;
    const p = families[f] ?? [0, 0];
    families[f] = [p[0] + bySpecies[id][0], p[1] + bySpecies[id][1]];
  }
  const famRows = Object.entries(families)
    .sort((a, b) => b[1][0] + b[1][1] - (a[1][0] + a[1][1]))
    .slice(0, 10);
  const sight = stats.byKind?.picture ?? [0, 0];
  const sound = stats.byKind?.sound ?? [0, 0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Your progress" back />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.tiles}>
          {[
            { v: master.length, l: 'Mastered', t: c.tiles[1] },
            { v: learning.length, l: 'Learning', t: c.tiles[3] },
            { v: `${accuracy(stats)}%`, l: 'Accuracy', t: c.tiles[0] },
            { v: stats.bestStreak, l: 'Best streak', t: c.tiles[4] },
          ].map((x) => (
            <View key={x.l} style={[styles.tile, { backgroundColor: x.t }]}>
              <Text style={[styles.tileValue, { color: c.ink }]}>{x.v}</Text>
              <Text style={[styles.tileLabel, { color: c.inkMuted }]}>{x.l}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.note, { color: c.inkMuted }]}>A bird counts as mastered after 3 right answers with 80% or more right.</Text>

        {stats.answered === 0 ? (
          <Text style={[styles.body, { color: c.inkMuted }]}>Play a quiz or two and your progress shows up here.</Text>
        ) : (
          <>
            <Text style={[styles.h2, { color: c.ink }]}>Sight and sound</Text>
            <Bar label="By sight (picture quizzes)" value={sight} />
            <Bar label="By ear (sound quizzes)" value={sound} />

            {famRows.length > 0 && (
              <>
                <Text style={[styles.h2, { color: c.ink }]}>By bird family</Text>
                {famRows.map(([f, v]) => (
                  <Bar key={f} label={f} value={v} />
                ))}
              </>
            )}

            {practise.length > 0 && (
              <>
                <Text style={[styles.h2, { color: c.ink }]}>Keep practising</Text>
                <View style={styles.chips}>
                  {practise.map((id) => (
                    <Pressable key={id} style={[styles.chip, { backgroundColor: c.field }]} onPress={() => router.push(`/species/${id}`)}>
                      <Text style={[styles.chipText, { color: c.ink }]}>
                        {names[id]?.name ?? '…'} <Text style={{ color: c.inkMuted }}>{pct(bySpecies[id])}%</Text>
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.actions}>
                  <Pressable
                    style={[styles.action, { backgroundColor: c.primary }]}
                    onPress={() => router.push({ pathname: '/quiz', params: { species: practise.join(',') } })}
                  >
                    <Feather name="zap" size={15} color={c.onPrimary} />
                    <Text style={[styles.actionText, { color: c.onPrimary }]}>Quiz these</Text>
                  </Pressable>
                  <Pressable style={[styles.action, { backgroundColor: c.tint }]} onPress={() => router.push('/flashcards')}>
                    <Feather name="layers" size={15} color={c.tintIcon} />
                    <Text style={[styles.actionText, { color: c.ink }]}>Flashcards</Text>
                  </Pressable>
                </View>
              </>
            )}

            {master.length > 0 && (
              <>
                <Text style={[styles.h2, { color: c.ink }]}>Mastered</Text>
                <View style={styles.chips}>
                  {master.map((id) => (
                    <View key={id} style={[styles.chip, { backgroundColor: '#E3F5EC' }]}>
                      <Feather name="check" size={12} color={c.correct} />
                      <Text style={[styles.chipText, { color: c.ink }]}>{names[id]?.name ?? '…'}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Bar({ label, value, sub }: { label: string; value: [number, number]; sub?: string }) {
  const c = useColors();
  return (
    <View style={styles.barRow} accessible accessibilityLabel={`${label}: ${pct(value)}% right from ${value[0] + value[1]} answers`}>
      <View style={styles.barHead}>
        <Text style={[styles.barLabel, { color: c.ink }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.barValue, { color: c.ink }]}>
          {pct(value)}% <Text style={{ color: c.inkMuted }}>· {sub ?? `${value[0] + value[1]} answers`}</Text>
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: c.field }]}>
        <View style={[styles.fill, { width: `${pct(value)}%`, backgroundColor: c.accent }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  tile: { width: '48%', flexGrow: 1, borderRadius: radius.tile, padding: space.l },
  tileValue: { fontFamily: font.display, fontSize: 28 },
  tileLabel: { fontFamily: font.semibold, fontSize: 12 },
  note: { fontFamily: font.medium, fontSize: 12 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  h2: { fontFamily: font.display, fontSize: 22, marginTop: space.l },
  barRow: { gap: 6 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', gap: space.m },
  barLabel: { flex: 1, fontFamily: font.semibold, fontSize: 14 },
  barValue: { fontFamily: font.bold, fontSize: 13 },
  track: { height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 10, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 6 },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  actions: { flexDirection: 'row', gap: space.s, marginTop: space.s },
  action: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: radius.pill },
  actionText: { fontFamily: font.semibold, fontSize: 14 },
});
