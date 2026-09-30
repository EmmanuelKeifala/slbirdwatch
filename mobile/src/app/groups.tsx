import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createGroup, joinGroup, myGroups, type Group } from '@/api';
import { useAuth } from '@/state/auth';
import { FormScroll } from '@/components/FormScroll';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

const KINDS: { kind: Group['kind']; label: string }[] = [
  { kind: 'club', label: 'Bird club' },
  { kind: 'school', label: 'School' },
  { kind: 'friends', label: 'Friends' },
];

/** COM-03: your groups, and joining or starting one. Sightings stay public as always; a group just gathers its members'. */
export default function Groups() {
  const c = useColors();
  const token = useAuth().session!.token;
  const [items, setItems] = useState<Group[] | null>(null);
  const [code, setCode] = useState('');
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<Group['kind']>('club');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    myGroups(token).then(
      (r) => setItems(r.items),
      () => setItems([]),
    );
  }, [token]);
  useFocusEffect(load);

  const run = async (fn: () => Promise<Group>) => {
    setBusy(true);
    try {
      const g = await fn();
      router.push(`/group/${g.id}`);
      setCode('');
      setName('');
      setDescription('');
      setMaking(false);
    } catch (e) {
      Alert.alert('That didn’t work', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Groups & clubs" back />
      <FormScroll contentContainerStyle={styles.content}>
        <Text style={[styles.lead, { color: c.inkMuted }]}>
          Bird clubs, school classes, friends. A group gathers its members’ outings and sightings, with its own board, challenges and quiz.
          Everyone’s sightings stay public on the map as always, so every group can see where birds are.
        </Text>

        {items === null ? (
          <ActivityIndicator color={c.accent} />
        ) : (
          items.map((g) => (
            <Pressable
              key={g.id}
              style={[styles.card, { borderColor: c.border }]}
              onPress={() => router.push(`/group/${g.id}`)}
              accessibilityRole="button"
            >
              <View style={[styles.icon, { backgroundColor: c.tint }]}>
                <Feather name={g.kind === 'school' ? 'book' : g.kind === 'friends' ? 'smile' : 'users'} size={20} color={c.tintIcon} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: c.ink }]}>{g.name}</Text>
                <Text style={[styles.meta, { color: c.inkMuted }]}>
                  {g.members} member{g.members === 1 ? '' : 's'}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={c.inkFaint} />
            </Pressable>
          ))
        )}

        <Text style={[styles.h2, { color: c.ink }]}>Join a group</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.code, { color: c.ink, backgroundColor: c.field }]}
            value={code}
            onChangeText={(t) =>
              setCode(
                t
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
                  .slice(0, 6),
              )
            }
            placeholder="CODE"
            placeholderTextColor={c.inkFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
          />
          <Pressable
            style={[styles.btn, { backgroundColor: c.primary }, (busy || code.length !== 6) && { opacity: 0.4 }]}
            disabled={busy || code.length !== 6}
            onPress={() => run(() => joinGroup(token, code))}
            accessibilityRole="button"
          >
            <Text style={[styles.btnText, { color: c.onPrimary }]}>Join</Text>
          </Pressable>
        </View>

        {!making ? (
          <Pressable style={[styles.add, { borderColor: c.primary }]} onPress={() => setMaking(true)} accessibilityRole="button">
            <Feather name="plus" size={18} color={c.ink} />
            <Text style={[styles.btnText, { color: c.ink }]}>Start a group</Text>
          </Pressable>
        ) : (
          <View style={[styles.form, { borderColor: c.border }]}>
            <Text style={[styles.h2, { color: c.ink, marginTop: 0 }]}>Start a group</Text>
            <View style={styles.row}>
              {KINDS.map((k) => (
                <Pressable
                  key={k.kind}
                  onPress={() => setKind(k.kind)}
                  style={[styles.chip, { backgroundColor: kind === k.kind ? c.primary : c.field }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: kind === k.kind }}
                >
                  <Text style={[styles.chipText, { color: kind === k.kind ? c.onPrimary : c.ink }]}>{k.label}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={[styles.input, { color: c.ink, backgroundColor: c.field }]}
              value={name}
              onChangeText={setName}
              placeholder="Name, e.g. Kenema Bird Club"
              placeholderTextColor={c.inkFaint}
              maxLength={60}
            />
            <TextInput
              style={[styles.input, styles.multi, { color: c.ink, backgroundColor: c.field }]}
              value={description}
              onChangeText={setDescription}
              placeholder="What you do (optional)"
              placeholderTextColor={c.inkFaint}
              maxLength={300}
              multiline
            />
            <Pressable
              style={[styles.btn, { backgroundColor: c.primary }, (busy || name.trim().length < 2) && { opacity: 0.4 }]}
              disabled={busy || name.trim().length < 2}
              onPress={() => run(() => createGroup(token, { name: name.trim(), description: description.trim(), kind }))}
              accessibilityRole="button"
            >
              <Text style={[styles.btnText, { color: c.onPrimary }]}>Create</Text>
            </Pressable>
          </View>
        )}
      </FormScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
  lead: { fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderWidth: 1.5, borderRadius: radius.card, padding: space.m },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: font.bold, fontSize: 16 },
  meta: { fontFamily: font.medium, fontSize: 12 },
  h2: { fontFamily: font.display, fontSize: 20, marginTop: space.m },
  row: { flexDirection: 'row', gap: space.s, alignItems: 'center', flexWrap: 'wrap' },
  input: { borderRadius: radius.tile, paddingHorizontal: space.l, minHeight: 48, fontFamily: font.regular, fontSize: 15 },
  code: { flex: 1, fontFamily: font.bold, fontSize: 20, letterSpacing: 6, textAlign: 'center' },
  multi: { minHeight: 80, paddingTop: space.m, textAlignVertical: 'top' },
  btn: { height: 48, borderRadius: radius.pill, paddingHorizontal: space.xl, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: font.semibold, fontSize: 15 },
  add: {
    flexDirection: 'row',
    gap: space.s,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: { borderWidth: 1.5, borderRadius: radius.card, padding: space.l, gap: space.m },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.m, height: 36, justifyContent: 'center' },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
});
