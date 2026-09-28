import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormScroll } from '@/FormScroll';
import { Bird3D } from '@/Bird3D';
import { GROUPS, searchTerms, TERMS, type Part, type Term } from '@/glossary';
import { Pressable } from '@/Pressable';
import { ScreenHeader } from '@/ScreenHeader';
import { SearchField } from '@/SearchField';
import { font, radius, space, useColors } from '@/theme';

/** LRN-07: tap a part of the bird, or search the glossary of birding terms. */
export default function Glossary() {
  const c = useColors();
  const [part, setPart] = useState<Part | undefined>('crown');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Term['group'] | undefined>(undefined);
  const chosen = TERMS.find((t) => t.part === part);
  const list = searchTerms(q, group);
  const scroll = useRef<ScrollView>(null);
  const show = (p: Part) => {
    setPart(p);
    scroll.current?.scrollTo({ y: 0, animated: true }); // back up to the bird, which turns to the part
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Glossary" back />
      <FormScroll ref={scroll} contentContainerStyle={styles.content}>
        <View style={[styles.diagram, { backgroundColor: c.tiles[0] }]}>
          <Bird3D selected={part} onSelect={setPart} />
          <Text style={[styles.tapHint, { color: c.inkMuted }]}>Drag to spin · pinch to zoom · tap a part</Text>
          <Text style={[styles.credit, { color: c.inkFaint }]}>Cher Ami, a Rock Pigeon · 3D scan: Smithsonian (CC0)</Text>
        </View>
        {chosen && (
          <View style={[styles.chosen, { borderColor: c.accent }]}>
            <Text style={[styles.chosenTerm, { color: c.ink }]}>{chosen.term}</Text>
            <Text style={[styles.body, { color: c.inkMuted }]}>{chosen.text}</Text>
          </View>
        )}

        <SearchField value={q} onChange={setQ} placeholder="Search terms, e.g. supercilium" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
          {[undefined, ...GROUPS].map((g) => {
            const on = g === group;
            return (
              <Pressable
                key={g ?? 'all'}
                onPress={() => setGroup(g)}
                style={[styles.chip, { backgroundColor: on ? c.primary : c.field }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipText, { color: on ? c.onPrimary : c.ink }]}>{g ?? 'All'}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {list.length === 0 ? (
          <Text style={[styles.body, { color: c.inkMuted }]}>No term matches “{q.trim()}”.</Text>
        ) : (
          list.map((t) => (
            <Pressable
              key={t.term}
              style={[styles.row, { borderColor: t.part && t.part === part ? c.accent : c.border }]}
              onPress={() => t.part && show(t.part)}
              disabled={!t.part}
              accessibilityRole={t.part ? 'button' : undefined}
            >
              <View style={styles.rowHead}>
                <Text style={[styles.term, { color: c.ink }]}>{t.term}</Text>
                <Text style={[styles.group, { color: c.inkFaint }]}>{t.part ? 'on the bird ↑' : t.group}</Text>
              </View>
              <Text style={[styles.body, { color: c.inkMuted }]}>{t.text}</Text>
            </Pressable>
          ))
        )}
      </FormScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
  diagram: { borderRadius: radius.card, alignItems: 'center', paddingBottom: space.m, overflow: 'hidden' },
  tapHint: { fontFamily: font.semibold, fontSize: 12 },
  credit: { fontFamily: font.medium, fontSize: 10, marginTop: 2 },
  chosen: { borderWidth: 2, borderRadius: radius.tile, padding: space.l, gap: 4 },
  chosenTerm: { fontFamily: font.display, fontSize: 22 },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 21 },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.m, height: 34, justifyContent: 'center' },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  row: { borderWidth: 1.5, borderRadius: radius.tile, padding: space.l, gap: 4 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.s },
  term: { flex: 1, fontFamily: font.bold, fontSize: 15 },
  group: { fontFamily: font.medium, fontSize: 11 },
});
