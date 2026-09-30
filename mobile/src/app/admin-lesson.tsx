import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { adminLessons, deleteLesson, putLesson, speciesCards, type AdminLesson } from '@/api';
import { useAuth } from '@/auth';
import { FamilyChips } from '@/FamilyChips';
import { FormScroll } from '@/FormScroll';
import { Pressable } from '@/Pressable';
import { ScreenHeader } from '@/ScreenHeader';
import { SpeciesPicker } from '@/SpeciesPicker';
import { font, radius, space, useColors } from '@/theme';

type Bird = { id: number; name: string };
const toSlug = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

/** ADM-05 (admins): write or edit a lesson — whole families, or up to 12 birds picked in order. */
export default function AdminLessonEditor() {
  const c = useColors();
  const token = useAuth().session!.token;
  const p = useLocalSearchParams<{ slug?: string; position?: string }>();
  const isNew = !p.slug;
  const [l, setL] = useState<AdminLesson | null>(
    isNew ? { slug: '', title: '', blurb: '', families: [], species_ids: [], position: Number(p.position ?? 0), published: true } : null,
  );
  const [birds, setBirds] = useState<Bird[]>([]);
  const [mode, setMode] = useState<'families' | 'birds'>('families');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) return;
    adminLessons(token).then(async (r) => {
      const found = r.items.find((x) => x.slug === p.slug);
      if (!found) return router.back();
      setL(found);
      setMode(found.species_ids.length ? 'birds' : 'families');
      if (found.species_ids.length) {
        const cards = await speciesCards(found.species_ids);
        const byId = Object.fromEntries(cards.items.map((b) => [b.id, b.english_name]));
        setBirds(found.species_ids.map((id) => ({ id, name: byId[id] ?? `#${id}` })));
      }
    }, () => router.back());
  }, [isNew, p.slug, token]);

  if (!l) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <ScreenHeader title="Lesson" back />
        <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
      </SafeAreaView>
    );
  }
  const slug = isNew ? toSlug(l.title) : l.slug;
  const setBirdList = (b: Bird[]) => {
    setBirds(b);
    setL({ ...l, species_ids: b.map((x) => x.id) });
  };
  const moveBird = (i: number, by: -1 | 1) => {
    const b = [...birds];
    [b[i], b[i + by]] = [b[i + by], b[i]];
    setBirdList(b);
  };

  const save = async () => {
    setBusy(true);
    try {
      await putLesson(token, {
        ...l,
        slug,
        families: mode === 'families' ? l.families : [],
        species_ids: mode === 'birds' ? l.species_ids : [],
      });
      router.back();
    } catch (e) {
      Alert.alert('Couldn’t save the lesson', e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const remove = () =>
    Alert.alert(`Delete “${l.title}”?`, 'It disappears from Learn. Scores people already have for it stay on their phones.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteLesson(token, l.slug).then(() => router.back(), () => {}) },
    ]);
  const ok = !busy && l.title.trim().length >= 2 && slug.length >= 2 && (mode === 'families' || birds.length > 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title={isNew ? 'New lesson' : 'Edit lesson'} back />
      <FormScroll contentContainerStyle={styles.content}>
        <Text style={[styles.label, { color: c.inkMuted }]}>Title</Text>
        <TextInput
          style={[styles.input, { color: c.ink, backgroundColor: c.field }]}
          value={l.title}
          onChangeText={(title) => setL({ ...l, title })}
          placeholder="e.g. Birds of the mangroves"
          placeholderTextColor={c.inkFaint}
          maxLength={80}
        />
        {isNew && !!slug && <Text style={[styles.hint, { color: c.inkFaint }]}>Link name: {slug}</Text>}
        <Text style={[styles.label, { color: c.inkMuted }]}>Description</Text>
        <TextInput
          style={[styles.input, styles.multi, { color: c.ink, backgroundColor: c.field }]}
          value={l.blurb}
          onChangeText={(blurb) => setL({ ...l, blurb })}
          placeholder="One or two lines on what learners will get from it"
          placeholderTextColor={c.inkFaint}
          maxLength={300}
          multiline
        />

        <Text style={[styles.label, { color: c.inkMuted }]}>Birds</Text>
        <View style={styles.tabs}>
          {(['families', 'birds'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={[styles.tab, { backgroundColor: mode === m ? c.primary : c.field }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === m }}
            >
              <Text style={[styles.tabText, { color: mode === m ? c.onPrimary : c.ink }]}>{m === 'families' ? 'By family' : 'Pick birds'}</Text>
            </Pressable>
          ))}
        </View>
        {mode === 'families' ? (
          <>
            <Text style={[styles.hint, { color: c.inkMuted }]}>
              The 8 most recorded Sierra Leone birds of these families. None: the most recorded birds overall.
            </Text>
            <FamilyChips value={l.families} onChange={(families) => setL({ ...l, families })} />
          </>
        ) : (
          <>
            <Text style={[styles.hint, { color: c.inkMuted }]}>Up to 12, taught in this order.</Text>
            {birds.map((b, i) => (
              <View key={b.id} style={[styles.bird, { borderColor: c.border }]}>
                <Text style={[styles.birdName, { color: c.ink }]}>
                  {i + 1}. {b.name}
                </Text>
                <Pressable disabled={i === 0} onPress={() => moveBird(i, -1)} hitSlop={8} accessibilityLabel={`Move ${b.name} up`}>
                  <Feather name="chevron-up" size={20} color={i === 0 ? c.border : c.ink} />
                </Pressable>
                <Pressable disabled={i === birds.length - 1} onPress={() => moveBird(i, 1)} hitSlop={8} accessibilityLabel={`Move ${b.name} down`}>
                  <Feather name="chevron-down" size={20} color={i === birds.length - 1 ? c.border : c.ink} />
                </Pressable>
                <Pressable onPress={() => setBirdList(birds.filter((x) => x.id !== b.id))} hitSlop={8} accessibilityLabel={`Remove ${b.name}`}>
                  <Feather name="x" size={20} color={c.wrong} />
                </Pressable>
              </View>
            ))}
            {birds.length < 12 && (
              <SpeciesPicker
                value={undefined}
                onChange={(s) => s && !birds.some((b) => b.id === s.id) && setBirdList([...birds, { id: s.id, name: s.english_name }])}
              />
            )}
          </>
        )}

        <View style={[styles.switchRow, { borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.birdName, { color: c.ink }]}>Show on Learn</Text>
            <Text style={[styles.hint, { color: c.inkMuted }]}>Off keeps it as a draft.</Text>
          </View>
          <Switch value={l.published} onValueChange={(published) => setL({ ...l, published })} />
        </View>

        <Pressable style={[styles.save, { backgroundColor: c.primary }, !ok && { opacity: 0.4 }]} disabled={!ok} onPress={save} accessibilityRole="button">
          <Text style={[styles.saveText, { color: c.onPrimary }]}>{busy ? 'Saving…' : 'Save lesson'}</Text>
        </Pressable>
        {!isNew && (
          <Pressable onPress={remove} accessibilityRole="button">
            <Text style={[styles.delete, { color: c.wrong }]}>Delete lesson</Text>
          </Pressable>
        )}
      </FormScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.s, paddingBottom: space.xxl * 2 },
  label: { fontFamily: font.semibold, fontSize: 13, marginTop: space.m },
  hint: { fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  input: { borderRadius: radius.tile, paddingHorizontal: space.l, minHeight: 48, fontFamily: font.regular, fontSize: 15 },
  multi: { minHeight: 90, paddingTop: space.m, textAlignVertical: 'top' },
  tabs: { flexDirection: 'row', gap: space.s },
  tab: { flex: 1, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontFamily: font.semibold, fontSize: 14 },
  bird: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderWidth: 1, borderRadius: radius.tile, padding: space.m },
  birdName: { flex: 1, fontFamily: font.semibold, fontSize: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.tile, padding: space.m, marginTop: space.m },
  save: { borderRadius: radius.pill, height: 50, alignItems: 'center', justifyContent: 'center', marginTop: space.l },
  saveText: { fontFamily: font.semibold, fontSize: 15 },
  delete: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center', marginTop: space.l },
});
