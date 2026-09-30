import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { putTip, similarSpecies, speciesTips, type IdTip } from '@/api';
import { useAuth } from '@/state/auth';
import { FormScroll } from '@/components/FormScroll';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

/** LIB-10: write or edit an ID tip (verifiers). A full screen, so the text box always stays above the keyboard. */
export default function TipEditor() {
  const c = useColors();
  const token = useAuth().session?.token;
  const p = useLocalSearchParams<{ species: string; name: string; other?: string }>();
  const speciesId = Number(p.species);
  const [tips, setTips] = useState<IdTip[]>([]);
  const [others, setOthers] = useState<{ id: number; english_name: string }[]>([]);
  const [otherId, setOtherId] = useState<number | null>(p.other ? Number(p.other) : null);
  const [text, setText] = useState<string | null>(null); // null until the existing tip has loaded
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([speciesTips(speciesId), similarSpecies(speciesId)]).then(
      ([t, s]) => {
        setTips(t.items);
        // lookalikes: the similar list, plus any bird that already has a pair tip here
        const list = s.items.map((x) => ({ id: x.id, english_name: x.english_name }));
        for (const tip of t.items) if (tip.other && !list.some((x) => x.id === tip.other!.id)) list.push(tip.other);
        setOthers(list);
        setText((cur) => cur ?? t.items.find((x) => (x.other?.id ?? null) === (p.other ? Number(p.other) : null))?.text ?? '');
      },
      () => setText((cur) => cur ?? ''),
    );
  }, [speciesId, p.other]);

  const pick = (id: number | null) => {
    setOtherId(id);
    setText(tips.find((x) => (x.other?.id ?? null) === id)?.text ?? '');
  };
  const save = async () => {
    setBusy(true);
    try {
      await putTip(token!, speciesId, (text ?? '').trim(), otherId);
      router.back();
    } catch (e) {
      Alert.alert('Couldn’t save the tip', e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const ok = !busy && (text ?? '').trim().length >= 10;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="ID tip" back />
      <FormScroll contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: c.ink }]}>{p.name}</Text>
        <Text style={[styles.label, { color: c.inkMuted }]}>About</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
          {[{ id: null as number | null, english_name: 'This bird' }, ...others].map((o) => {
            const on = otherId === o.id;
            return (
              <Pressable
                key={o.id ?? 'general'}
                onPress={() => pick(o.id)}
                style={[styles.chip, { backgroundColor: on ? c.accent : c.field }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipText, { color: on ? c.onAccent : c.ink }]}>{o.id ? `vs ${o.english_name}` : o.english_name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <TextInput
          style={[styles.input, { color: c.ink, backgroundColor: c.field }]}
          placeholder={otherId ? 'What tells them apart? Size, bill, call, where it lives…' : 'What makes it easy to recognise?'}
          placeholderTextColor={c.inkFaint}
          value={text ?? ''}
          editable={text !== null}
          onChangeText={setText}
          maxLength={1000}
          multiline
          autoFocus
        />
        <View style={styles.foot}>
          <Text style={[styles.label, { color: c.inkFaint }]}>{(text ?? '').length} / 1000</Text>
        </View>
        <Pressable
          style={[styles.save, { backgroundColor: c.primary }, !ok && { opacity: 0.4 }]}
          onPress={save}
          disabled={!ok}
          accessibilityRole="button"
        >
          <Text style={[styles.saveText, { color: c.onPrimary }]}>{busy ? 'Saving…' : 'Save tip'}</Text>
        </Pressable>
      </FormScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
  title: { fontFamily: font.display, fontSize: 26 },
  label: { fontFamily: font.medium, fontSize: 12 },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 7 },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  input: { minHeight: 160, borderRadius: radius.tile, padding: space.m, fontFamily: font.regular, fontSize: 15, lineHeight: 22, textAlignVertical: 'top' },
  foot: { alignItems: 'flex-end', marginTop: -space.s },
  save: { borderRadius: radius.pill, height: 50, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: font.semibold, fontSize: 15 },
});
