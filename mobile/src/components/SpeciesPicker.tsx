import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { useBringToTop } from '@/components/FormScroll';
import { Pressable } from '@/components/Pressable';

import { pickSpecies, type PickHint, type PickItem, type Species } from '@/api';
import { useAuth } from '@/state/auth';
import { searchCached } from '@/state/speciesCache';
import { font, radius, space, useColors, type Colors } from '@/theme';

/** A species, null for "I don't know", or undefined while not chosen yet. */
export type Picked = Pick<Species, 'id' | 'english_name' | 'scientific_name'> | null | undefined;

const HINTS: Record<PickHint, string> = {
  recent: 'You’ve logged this before',
  likely: 'Seen in Sierra Leone at this time of year',
  region: 'Recorded in Sierra Leone',
  '': '',
};

/**
 * Species chooser with an explicit "I don't know" option (OBS-06). Before typing it suggests your recent birds and
 * what's seen in Sierra Leone in `month` (the sighting's month, 1–12); typing searches common, local and scientific names.
 */
export function SpeciesPicker({ value, onChange, month }: { value: Picked; onChange: (s: Picked) => void; month?: number }) {
  const c = useColors();
  const s = styles(c);
  const token = useAuth().session?.token;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickItem[]>([]);
  const [loading, setLoading] = useState(false);
  const m = month ?? new Date().getMonth() + 1;
  const box = useRef<View>(null);
  const bringToTop = useBringToTop(); // suggestions are listed below the box

  useEffect(() => {
    if (value !== undefined) return;
    const q = query.trim();
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        setResults((await pickSpecies(q, m, token, ctrl.signal)).items.slice(0, q ? 8 : 5));
      } catch {
        // No signal (OBS-09): search the Sierra Leone list kept on the phone.
        if (!ctrl.signal.aborted)
          setResults(q ? searchCached(q).map((sp) => ({ ...sp, family_sci: '', family_en: '', image: null, hint: 'region' as const })) : []);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, q ? 250 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, m, token, value]);

  if (value !== undefined) {
    return (
      <View style={s.selected}>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{value ? value.english_name : "I don't know"}</Text>
          <Text style={s.sci}>{value ? value.scientific_name : 'The community will help identify it'}</Text>
        </View>
        <Pressable onPress={() => onChange(undefined)} accessibilityRole="button" hitSlop={8}>
          <Text style={s.change}>Change</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View ref={box} style={{ gap: space.s }}>
      <TextInput
        onFocus={() => bringToTop(box.current)}
        style={s.input}
        placeholder="Which bird was it?"
        placeholderTextColor={c.inkMuted}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        accessibilityLabel="Search species"
      />
      {loading && <ActivityIndicator color={c.ink} />}
      {!query.trim() && results.length > 0 && <Text style={s.label}>Suggestions</Text>}
      {results.map((r) => (
        <Pressable
          key={r.id}
          style={s.result}
          onPress={() => {
            onChange(r);
            setQuery('');
          }}
          accessibilityRole="button"
        >
          <Text style={s.name}>{r.english_name}</Text>
          <Text style={s.sci}>{r.scientific_name}</Text>
          {!!r.hint && <Text style={s.hint}>{HINTS[r.hint]}</Text>}
        </Pressable>
      ))}
      <Pressable style={s.unknown} onPress={() => onChange(null)} accessibilityRole="button">
        <Text style={s.unknownText}>I don&apos;t know — ask the community</Text>
      </Pressable>
    </View>
  );
}

const styles = (c: Colors) =>
  StyleSheet.create({
    input: {
      fontFamily: font.regular,
      fontSize: 15,
      color: c.ink,
      backgroundColor: c.field,
      borderRadius: radius.pill,
      paddingHorizontal: space.xl,
      height: 48,
    },
    result: { paddingVertical: space.s, paddingHorizontal: space.l },
    label: { fontFamily: font.semibold, fontSize: 12, color: c.inkFaint, paddingHorizontal: space.l, marginTop: space.xs },
    hint: { fontFamily: font.medium, fontSize: 12, color: c.accentDeep, marginTop: 2 },
    selected: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.m,
      backgroundColor: c.surface,
      borderColor: c.accent,
      borderWidth: 2,
      borderRadius: radius.card,
      padding: space.l,
    },
    name: { fontFamily: font.semibold, fontSize: 16, color: c.ink },
    sci: { fontFamily: font.italic, fontSize: 13, color: c.inkMuted },
    change: { fontFamily: font.semibold, fontSize: 14, color: c.ink, textDecorationLine: 'underline' },
    unknown: {
      borderColor: c.border,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderRadius: radius.pill,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    unknownText: { fontFamily: font.medium, fontSize: 14, color: c.inkMuted },
  });
