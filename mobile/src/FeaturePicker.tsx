import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/Pressable';

import { getFeatureFields, type FeatureField, type Features } from '@/api';
import { font, radius, space, useColors, type Colors } from '@/theme';

/** OBS-05: optional structured ID features, as chip groups. The vocabulary comes from the API. */
export function FeaturePicker({ value, onChange }: { value: Features; onChange: (f: Features) => void }) {
  const c = useColors();
  const s = styles(c);
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<FeatureField[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || fields) return;
    getFeatureFields()
      .then(setFields)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, fields]);

  function toggle(f: FeatureField, v: string) {
    const next = { ...value };
    if (f.multi) {
      const list = (next[f.key] as string[] | undefined) ?? [];
      next[f.key] = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
      if (!(next[f.key] as string[]).length) delete next[f.key];
    } else if (next[f.key] === v) delete next[f.key];
    else next[f.key] = v;
    onChange(next);
  }

  const picked = Object.values(value).flat().length;

  return (
    <View style={s.box}>
      <Pressable
        style={s.header}
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={s.title}>ID features {picked ? `· ${picked} noted` : '(optional)'}</Text>
        <Text style={s.chevron}>{open ? '−' : '+'}</Text>
      </Pressable>
      {open && !fields && !error && <ActivityIndicator color={c.ink} />}
      {error && <Text style={s.error}>Couldn’t load features ({error}).</Text>}
      {open &&
        fields?.map((f) => (
          <View key={f.key} style={{ gap: space.s }}>
            <Text style={s.label}>
              {f.label}
              {f.multi ? ' · pick any' : ''}
            </Text>
            <View style={s.chips}>
              {f.options.map((o) => {
                const on = f.multi ? ((value[f.key] as string[] | undefined) ?? []).includes(o.value) : value[f.key] === o.value;
                return (
                  <Pressable
                    key={o.value}
                    style={[s.chip, on && s.chipOn]}
                    onPress={() => toggle(f, o.value)}
                    accessibilityRole={f.multi ? 'checkbox' : 'radio'}
                    accessibilityState={f.multi ? { checked: on } : { selected: on }}
                  >
                    <Text style={[s.chipText, on && { color: c.onAccent }]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
    </View>
  );
}

const styles = (c: Colors) =>
  StyleSheet.create({
    box: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: space.l,
      gap: space.m,
      marginTop: space.m,
    },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
    title: { fontFamily: font.semibold, fontSize: 15, color: c.ink },
    chevron: { fontFamily: font.bold, fontSize: 20, color: c.ink },
    label: { fontFamily: font.medium, fontSize: 12, color: c.inkMuted },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
    chip: {
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: space.m,
      minHeight: 36,
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { fontFamily: font.medium, fontSize: 13, color: c.ink },
    error: { fontFamily: font.medium, fontSize: 14, color: c.wrong },
  });
