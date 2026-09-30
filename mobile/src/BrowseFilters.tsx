import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Pressable } from '@/Pressable';

import { getFeatureFields, listFamilies, type BrowseFilters, type Family, type FeatureField } from '@/api';
import { font, radius, space, useColors } from '@/theme';
import { roughPosition } from '@/location';

type Dim = 'family' | 'habitat' | 'size' | 'colour';
const FIELD: Record<Exclude<Dim, 'family'>, string> = { habitat: 'habitat', size: 'size', colour: 'colours' };
const TITLE: Record<Dim, string> = { family: 'Family', habitat: 'Habitat', size: 'Size', colour: 'Colour' };

/** LIB-03: chips for near me / family / habitat / size / colour, with an inline option panel. */
export function BrowseFilterBar({ value, onChange }: { value: BrowseFilters; onChange: (f: BrowseFilters) => void }) {
  const c = useColors();
  const [open, setOpen] = useState<Dim | null>(null);
  const [fields, setFields] = useState<FeatureField[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyQuery, setFamilyQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  useEffect(() => {
    getFeatureFields().then(setFields).catch(() => {});
  }, []);
  useEffect(() => {
    if (open === 'family' && families.length === 0) listFamilies().then((r) => setFamilies(r.items)).catch(() => {});
  }, [open, families.length]);

  const label = (dim: Dim) => {
    const v = value[dim];
    if (!v) return TITLE[dim];
    if (dim === 'family') return families.find((f) => f.family_sci === v)?.family_en ?? v;
    const opt = fields.find((f) => f.key === FIELD[dim])?.options.find((o) => o.value === v);
    return opt ? opt.label.replace(/\s*\(.*\)$/, '') : v;
  };

  async function toggleNear() {
    setLocError(null);
    if (value.near) {
      onChange({ ...value, near: undefined });
      return;
    }
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) throw new Error('Allow location to see birds seen near you.');
      const pos = await roughPosition();
      onChange({ ...value, near: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
    } catch (e) {
      setLocError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocating(false);
    }
  }

  const chip = (key: string, text: string, on: boolean, onPress: () => void, icon?: 'map-pin' | 'chevron-down') => (
    <Pressable
      key={key}
      style={[styles.chip, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent : c.bg }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      {icon && <Feather name={icon} size={14} color={on ? c.onAccent : c.inkMuted} />}
      <Text style={[styles.chipText, { color: on ? c.onAccent : c.ink }]} numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );

  const active = Object.values(value).some(Boolean);
  const options =
    open && open !== 'family' ? (fields.find((f) => f.key === FIELD[open])?.options ?? []) : [];
  const shownFamilies = families.filter((f) =>
    `${f.family_en} ${f.family_sci}`.toLowerCase().includes(familyQuery.trim().toLowerCase()),
  );

  return (
    <View style={{ gap: space.s }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {locating ? (
          <View style={[styles.chip, { borderColor: c.border }]}>
            <ActivityIndicator size="small" color={c.accent} />
          </View>
        ) : (
          chip('near', 'Near me', !!value.near, toggleNear, 'map-pin')
        )}
        {(['family', 'habitat', 'size', 'colour'] as Dim[]).map((d) =>
          chip(d, label(d), !!value[d], () => setOpen(open === d ? null : d), 'chevron-down'),
        )}
        {active && (
          <Pressable
            onPress={() => {
              onChange({});
              setOpen(null);
            }}
            style={styles.clear}
            accessibilityRole="button"
          >
            <Text style={[styles.chipText, { color: c.accentDeep }]}>Clear</Text>
          </Pressable>
        )}
      </ScrollView>
      {locError && <Text style={[styles.note, { color: c.wrong }]}>{locError}</Text>}

      {open && (
        <View style={[styles.panel, { borderColor: c.border, backgroundColor: c.bg }]}>
          {open === 'family' ? (
            <>
              <TextInput
                style={[styles.input, { backgroundColor: c.field, color: c.ink }]}
                placeholder="Find a family, e.g. sunbirds"
                placeholderTextColor={c.inkFaint}
                value={familyQuery}
                onChangeText={setFamilyQuery}
              />
              <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {families.length === 0 && <ActivityIndicator color={c.accent} />}
                {shownFamilies.map((f) => (
                  <Pressable
                    key={f.family_sci}
                    style={styles.familyRow}
                    onPress={() => {
                      onChange({ ...value, family: value.family === f.family_sci ? undefined : f.family_sci });
                      setOpen(null);
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.familyName, { color: value.family === f.family_sci ? c.accentDeep : c.ink }]}>
                      {f.family_en}
                    </Text>
                    <Text style={[styles.note, { color: c.inkFaint }]}>
                      {f.family_sci} · {f.species}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : (
            <>
              <View style={styles.options}>
                {options.map((o) =>
                  chip(o.value, o.label, value[open] === o.value, () => {
                    onChange({ ...value, [open]: value[open] === o.value ? undefined : o.value });
                    setOpen(null);
                  }),
                )}
              </View>
              <Text style={[styles.note, { color: c.inkFaint }]}>Based on what birders recorded on confirmed sightings.</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.s, paddingRight: space.l },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingHorizontal: space.m,
    maxWidth: 200,
  },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  clear: { height: 36, justifyContent: 'center', paddingHorizontal: space.s },
  panel: { borderWidth: 1.5, borderRadius: radius.tile, padding: space.m, gap: space.s },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  input: { fontFamily: font.regular, fontSize: 14, borderRadius: radius.pill, paddingHorizontal: space.l, height: 40 },
  familyRow: { paddingVertical: space.s },
  familyName: { fontFamily: font.semibold, fontSize: 14 },
  note: { fontFamily: font.medium, fontSize: 12 },
});
