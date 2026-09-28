import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormScroll } from '@/FormScroll';
import { addLocalName, changeTaxonomy, deleteLocalName, getSpecies, setSensitive, type LocalName, type SpeciesDetail } from '@/api';
import { useAuth } from '@/auth';
import { LANGUAGES, languageLabel } from '@/languages';
import { Pressable } from '@/Pressable';
import { ScreenHeader } from '@/ScreenHeader';
import { SpeciesPicker, type Picked } from '@/SpeciesPicker';
import { font, radius, space, useColors, type Colors } from '@/theme';

/** ADM-02 (admins): local names for a species, and merging or splitting it after a taxonomy update. */
export default function SpeciesAdmin() {
  const c = useColors();
  const s = styles(c);
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuth().session!.token;
  const [sp, setSp] = useState<SpeciesDetail | null>(null);
  const [names, setNames] = useState<LocalName[]>([]);
  const [name, setName] = useState('');
  const [lang, setLang] = useState<string>('kri');
  const [mode, setMode] = useState<'merge' | 'split'>('merge');
  const [into, setInto] = useState<{ id: number; english_name: string }[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [guard, setGuard] = useState({ on: false, km: 11 });

  // ADM-03: saved as soon as it changes.
  const saveGuard = (next: { on: boolean; km: number }) => {
    const before = guard;
    setGuard(next);
    setSensitive(token, Number(id), next.on, next.km).catch((e) => {
      setGuard(before);
      fail(e);
    });
  };

  useEffect(() => {
    getSpecies(Number(id)).then((d) => {
      setSp(d);
      setNames(d.local_names);
      setGuard({ on: d.sensitive, km: d.obscure_km });
    });
  }, [id]);

  // Picking a species adds it to the targets (one for a merge, several for a split).
  const addTarget = (p: Picked) => {
    if (!p || p.id === Number(id) || into.some((x) => x.id === p.id)) return;
    setInto(mode === 'merge' ? [p] : [...into, p]);
  };

  const fail = (e: unknown) => Alert.alert('Couldn’t save', e instanceof Error ? e.message : String(e));

  async function addName() {
    setBusy(true);
    try {
      setNames((await addLocalName(token, Number(id), name.trim(), lang)).items);
      setName('');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    const targets = into.map((x) => x.english_name).join(' and ');
    Alert.alert(
      mode === 'merge' ? `Merge into ${targets}?` : `Split into ${targets}?`,
      mode === 'merge'
        ? `All sightings, IDs, photos and recordings of ${sp!.english_name} move to ${targets}, and ${sp!.english_name} is retired. This can’t be undone in the app.`
        : `${sp!.english_name} stays with its sightings and links to the new species. Its sightings go back to verifiers to re-identify.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: mode === 'merge' ? 'Merge' : 'Split',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await changeTaxonomy(token, mode, Number(id), into.map((x) => x.id), note.trim());
              Alert.alert(mode === 'merge' ? 'Merged' : 'Split saved');
              router.replace(mode === 'merge' ? `/species/${into[0].id}` : `/species/${id}`);
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  if (!sp) {
    return (
      <SafeAreaView style={[s.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={c.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <ScreenHeader title="Species admin" back />
      <View style={{ flex: 1 }}>
        <FormScroll contentContainerStyle={s.content}>
          <Text style={s.name}>{sp.english_name}</Text>
          <Text style={s.sci}>{sp.scientific_name}</Text>

          <Text style={s.h2}>Local names</Text>
          {names.length === 0 && <Text style={s.hint}>No local names yet. They show on the species page and work in search.</Text>}
          {names.map((n) => (
            <View key={n.name} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{n.name}</Text>
                <Text style={s.hint}>{languageLabel(n.language)}</Text>
              </View>
              <Pressable
                onPress={() => deleteLocalName(token, Number(id), n.name).then((r) => setNames(r.items), fail)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${n.name}`}
              >
                <Feather name="trash-2" size={18} color={c.inkMuted} />
              </Pressable>
            </View>
          ))}
          <TextInput
            style={s.input}
            placeholder="Add a name, e.g. the Krio name"
            placeholderTextColor={c.inkFaint}
            value={name}
            onChangeText={setName}
            maxLength={100}
          />
          <View style={s.chips}>
            {LANGUAGES.map((l) => (
              <Pressable
                key={l.code}
                style={[s.chip, lang === l.code && { backgroundColor: c.accent, borderColor: c.accent }]}
                onPress={() => setLang(l.code)}
                accessibilityRole="radio"
                accessibilityState={{ selected: lang === l.code }}
              >
                <Text style={[s.chipText, lang === l.code && { color: c.onAccent }]}>{l.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={[s.primary, (!name.trim() || busy) && { opacity: 0.5 }]} disabled={!name.trim() || busy} onPress={addName}>
            <Text style={s.primaryText}>Add name</Text>
          </Pressable>

          <Text style={s.h2}>Sensitive species</Text>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Blur its locations</Text>
              <Text style={s.hint}>Others see sightings only to the nearest area. Observers and verifiers still see the exact spot.</Text>
            </View>
            <Switch
              value={guard.on}
              onValueChange={(on) => saveGuard({ ...guard, on })}
              trackColor={{ true: c.accent, false: c.border }}
              accessibilityLabel="Sensitive species"
            />
          </View>
          {guard.on && (
            <View style={s.chips}>
              {[11, 22, 55].map((km) => (
                <Pressable
                  key={km}
                  style={[s.chip, guard.km === km && { backgroundColor: c.accent, borderColor: c.accent }]}
                  onPress={() => saveGuard({ ...guard, km })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: guard.km === km }}
                >
                  <Text style={[s.chipText, guard.km === km && { color: c.onAccent }]}>About {km} km</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={s.h2}>Taxonomy update</Text>
          <Text style={s.hint}>
            When a new taxonomy lumps this species into another, merge it. When it splits this species, list the new species.
          </Text>
          <View style={s.chips}>
            {(['merge', 'split'] as const).map((m) => (
              <Pressable
                key={m}
                style={[s.chip, mode === m && { backgroundColor: c.accent, borderColor: c.accent }]}
                onPress={() => {
                  setMode(m);
                  setInto([]);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode === m }}
              >
                <Text style={[s.chipText, mode === m && { color: c.onAccent }]}>{m === 'merge' ? 'Merge into…' : 'Split into…'}</Text>
              </Pressable>
            ))}
          </View>
          {into.map((x) => (
            <View key={x.id} style={s.row}>
              <Text style={[s.rowTitle, { flex: 1 }]}>{x.english_name}</Text>
              <Pressable onPress={() => setInto(into.filter((y) => y.id !== x.id))} hitSlop={10} accessibilityRole="button">
                <Feather name="x" size={18} color={c.inkMuted} />
              </Pressable>
            </View>
          ))}
          {(mode === 'split' || into.length === 0) && <SpeciesPicker value={undefined} onChange={addTarget} />}
          <TextInput
            style={s.input}
            placeholder="Note (e.g. IOC 16.1)"
            placeholderTextColor={c.inkFaint}
            value={note}
            onChangeText={setNote}
            maxLength={1000}
          />
          <Pressable
            style={[s.danger, (into.length < (mode === 'merge' ? 1 : 2) || busy) && { opacity: 0.5 }]}
            disabled={into.length < (mode === 'merge' ? 1 : 2) || busy}
            onPress={apply}
            accessibilityRole="button"
          >
            <Text style={s.primaryText}>{mode === 'merge' ? 'Merge' : 'Split (2 or more species)'}</Text>
          </Pressable>
        </FormScroll>
      </View>
    </SafeAreaView>
  );
}

const styles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
    name: { fontFamily: font.display, fontSize: 30, lineHeight: 34, color: c.ink },
    sci: { fontFamily: font.italic, fontSize: 14, color: c.inkMuted },
    h2: { fontFamily: font.display, fontSize: 22, color: c.ink, marginTop: space.xl },
    hint: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: c.inkMuted },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderColor: c.border, borderWidth: 1.5, borderRadius: radius.tile, padding: space.m },
    rowTitle: { fontFamily: font.semibold, fontSize: 15, color: c.ink },
    input: { fontFamily: font.regular, fontSize: 15, color: c.ink, backgroundColor: c.field, borderRadius: radius.pill, paddingHorizontal: space.xl, height: 50 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
    chip: { borderColor: c.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 7 },
    chipText: { fontFamily: font.semibold, fontSize: 13, color: c.ink },
    primary: { backgroundColor: c.primary, borderRadius: radius.pill, height: 50, alignItems: 'center', justifyContent: 'center' },
    danger: { backgroundColor: c.wrong, borderRadius: radius.pill, height: 50, alignItems: 'center', justifyContent: 'center', marginTop: space.s },
    primaryText: { fontFamily: font.semibold, fontSize: 15, color: '#FFFFFF' },
  });
