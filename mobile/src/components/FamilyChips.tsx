import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { listFamilies, type Family } from '@/api';
import { useBringToTop } from '@/components/FormScroll';
import { Pressable } from '@/components/Pressable';
import { font, radius, space, useColors } from '@/theme';

/** ADM-05: pick bird families (one or several) by searching their English or scientific names. */
export function FamilyChips({ value, onChange, single }: { value: string[]; onChange: (v: string[]) => void; single?: boolean }) {
  const c = useColors();
  const [all, setAll] = useState<Family[]>([]);
  const [q, setQ] = useState('');
  const bringToTop = useBringToTop();
  const [box, setBox] = useState<View | null>(null);
  useEffect(() => {
    listFamilies().then((r) => setAll(r.items), () => {});
  }, []);
  const chosen = all.filter((f) => value.includes(f.family_sci));
  const found = q.trim()
    ? all.filter((f) => !value.includes(f.family_sci) && `${f.family_en} ${f.family_sci}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)
    : [];
  const chip = (f: Family, on: boolean) => (
    <Pressable
      key={f.family_sci}
      onPress={() => {
        onChange(on ? value.filter((v) => v !== f.family_sci) : single ? [f.family_sci] : [...value, f.family_sci]);
        setQ('');
      }}
      style={[styles.chip, { backgroundColor: on ? c.accent : c.field }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
    >
      <Text style={[styles.chipText, { color: on ? c.onAccent : c.ink }]}>
        {f.family_en} {on ? '×' : '+'}
      </Text>
    </Pressable>
  );
  return (
    <View ref={setBox} style={{ gap: space.s }}>
      {chosen.length > 0 && <View style={styles.wrap}>{chosen.map((f) => chip(f, true))}</View>}
      <TextInput
        style={[styles.input, { color: c.ink, backgroundColor: c.field }]}
        placeholder={single ? 'Find a family, e.g. kingfishers' : 'Add a family, e.g. sunbirds'}
        placeholderTextColor={c.inkFaint}
        value={q}
        onChangeText={setQ}
        onFocus={() => bringToTop(box)}
        autoCorrect={false}
      />
      {found.length > 0 && <View style={styles.wrap}>{found.map((f) => chip(f, false))}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 7 },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  input: { borderRadius: radius.pill, paddingHorizontal: space.l, height: 44, fontFamily: font.regular, fontSize: 15 },
});
