import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/Pressable';

import type { SoundRecording } from '@/api';
import { SoundPlayer } from '@/SoundPlayer';
import { font, radius, space, useColors } from '@/theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KINDS = { song: 'Songs', call: 'Calls', alarm: 'Alarm calls', flight: 'Flight calls' } as const;
const ONE = { song: 'Song', call: 'Call', alarm: 'Alarm call', flight: 'Flight call' } as const;

function title(s: SoundRecording) {
  const when = s.month ? `${MONTHS[s.month - 1]}${s.season ? ` (${s.season} season)` : ''}` : '';
  const sex = ['male', 'female'].includes(s.sex) ? s.sex[0].toUpperCase() + s.sex.slice(1) : '';
  return [ONE[s.kind], sex, s.country, when].filter(Boolean).join(' · ');
}

/** LIB-09: recordings grouped by kind, each with where and when it was recorded and its credit. */
export function SoundGallery({ sounds }: { sounds: SoundRecording[] }) {
  const c = useColors();
  const kinds = (Object.keys(KINDS) as SoundRecording['kind'][]).filter((k) => sounds.some((s) => s.kind === k));
  const [kind, setKind] = useState(kinds[0]);

  return (
    <View style={{ gap: space.m }}>
      {kinds.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
          {kinds.map((k) => {
            const on = k === kind;
            return (
              <Pressable
                key={k}
                onPress={() => setKind(k)}
                style={[styles.chip, { backgroundColor: on ? c.accent : c.field }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipText, { color: on ? c.onAccent : c.ink }]}>{KINDS[k]}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {sounds
        .filter((s) => s.kind === kind)
        .map((s) => (
          <View key={s.url} style={{ gap: 6 }}>
            <Text style={[styles.title, { color: c.ink }]}>{title(s)}</Text>
            <SoundPlayer sound={s} caption={`${s.credit} · ${s.licence}`} />
            <Pressable onPress={() => Linking.openURL(s.source_url)} accessibilityRole="link">
              <Text style={[styles.source, { color: c.inkFaint }]}>Recording from xeno-canto.org</Text>
            </Pressable>
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 7 },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  title: { fontFamily: font.semibold, fontSize: 14 },
  source: { fontFamily: font.medium, fontSize: 11, marginLeft: space.s },
});
