import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { adminChallenges, putChallenge, type AdminChallenge } from '@/api';
import { useAuth } from '@/state/auth';
import { FamilyChips } from '@/components/FamilyChips';
import { FormScroll } from '@/components/FormScroll';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

/** ADM-05 (admins): this week's and the next three weeks' challenges. Tap one to rewrite it. */
export default function AdminChallenges() {
  const c = useColors();
  const token = useAuth().session!.token;
  const [data, setData] = useState<{ items: AdminChallenge[]; kinds: { kind: string; title: string }[] } | null>(null);
  const [edit, setEdit] = useState<AdminChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    adminChallenges(token).then(setData, () => {});
  }, [token]);
  useFocusEffect(load);

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await putChallenge(token, edit);
      setEdit(null);
      load();
    } catch (e) {
      Alert.alert('Couldn’t save', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const weeks = [...new Set((data?.items ?? []).map((x) => x.week))];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Weekly challenges" back />
      {!data ? (
        <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
      ) : (
        <FormScroll contentContainerStyle={styles.content}>
          <Text style={[styles.hint, { color: c.inkMuted }]}>
            Three a week, filled in automatically. Rewrite any of them up to the end of its week; finished weeks stay as they were.
          </Text>
          {weeks.map((w, wi) => (
            <View key={w} style={{ gap: space.s }}>
              <Text style={[styles.week, { color: c.ink }]}>
                {wi === 0 ? 'This week' : wi === 1 ? 'Next week' : `Week of ${new Date(w).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
              </Text>
              {data.items
                .filter((x) => x.week === w)
                .map((ch) =>
                  edit?.id === ch.id ? (
                    <View key={ch.id} style={[styles.card, { borderColor: c.accent, backgroundColor: c.tint }]}>
                      <Text style={[styles.label, { color: c.inkMuted }]}>What counts</Text>
                      <View style={styles.wrap}>
                        {data.kinds.map((k) => {
                          const on = edit.kind === k.kind;
                          return (
                            <Pressable
                              key={k.kind}
                              onPress={() => setEdit({ ...edit, kind: k.kind, param: k.kind === 'family_photo' ? edit.param : '' })}
                              style={[styles.chip, { backgroundColor: on ? c.primary : c.field }]}
                              accessibilityRole="radio"
                              accessibilityState={{ selected: on }}
                            >
                              <Text style={[styles.chipText, { color: on ? c.onPrimary : c.ink }]}>{k.title}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      {edit.kind === 'family_photo' && (
                        <FamilyChips single value={edit.param ? [edit.param] : []} onChange={(v) => setEdit({ ...edit, param: v[0] ?? '' })} />
                      )}
                      <Text style={[styles.label, { color: c.inkMuted }]}>Title</Text>
                      <TextInput
                        style={[styles.input, { color: c.ink, backgroundColor: c.bg }]}
                        value={edit.title}
                        onChangeText={(title) => setEdit({ ...edit, title })}
                        maxLength={60}
                      />
                      <Text style={[styles.label, { color: c.inkMuted }]}>Description</Text>
                      <TextInput
                        style={[styles.input, styles.multi, { color: c.ink, backgroundColor: c.bg }]}
                        value={edit.description}
                        onChangeText={(description) => setEdit({ ...edit, description })}
                        maxLength={200}
                        multiline
                      />
                      <Text style={[styles.label, { color: c.inkMuted }]}>Goal</Text>
                      <View style={styles.stepper}>
                        <Pressable onPress={() => setEdit({ ...edit, goal: Math.max(1, edit.goal - 1) })} style={[styles.step, { backgroundColor: c.field }]} accessibilityLabel="Lower the goal">
                          <Text style={[styles.stepText, { color: c.ink }]}>−</Text>
                        </Pressable>
                        <Text style={[styles.goal, { color: c.ink }]}>{edit.goal}</Text>
                        <Pressable onPress={() => setEdit({ ...edit, goal: Math.min(50, edit.goal + 1) })} style={[styles.step, { backgroundColor: c.field }]} accessibilityLabel="Raise the goal">
                          <Text style={[styles.stepText, { color: c.ink }]}>+</Text>
                        </Pressable>
                      </View>
                      <View style={styles.actions}>
                        <Pressable onPress={() => setEdit(null)} style={[styles.btn, { backgroundColor: c.field }]} accessibilityRole="button">
                          <Text style={[styles.btnText, { color: c.ink }]}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          onPress={save}
                          disabled={busy || (edit.kind === 'family_photo' && !edit.param)}
                          style={[styles.btn, { backgroundColor: c.primary }, (busy || (edit.kind === 'family_photo' && !edit.param)) && { opacity: 0.4 }]}
                          accessibilityRole="button"
                        >
                          <Text style={[styles.btnText, { color: c.onPrimary }]}>{busy ? 'Saving…' : 'Save'}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable key={ch.id} onPress={() => setEdit(ch)} style={[styles.card, { borderColor: c.border }]} accessibilityRole="button">
                      <Text style={[styles.title, { color: c.ink }]}>{ch.title}</Text>
                      <Text style={[styles.hint, { color: c.inkMuted }]}>{ch.description}</Text>
                      <Text style={[styles.hint, { color: c.inkFaint }]}>
                        Goal {ch.goal}
                        {ch.param ? ` · ${ch.param}` : ''} · tap to edit
                      </Text>
                    </Pressable>
                  ),
                )}
            </View>
          ))}
        </FormScroll>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.l, paddingBottom: space.xxl * 2 },
  week: { fontFamily: font.display, fontSize: 20 },
  card: { borderWidth: 1.5, borderRadius: radius.card, padding: space.m, gap: 4 },
  title: { fontFamily: font.bold, fontSize: 15 },
  hint: { fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  label: { fontFamily: font.semibold, fontSize: 12, marginTop: space.s },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 7 },
  chipText: { fontFamily: font.semibold, fontSize: 12 },
  input: { borderRadius: radius.tile, paddingHorizontal: space.m, minHeight: 44, fontFamily: font.regular, fontSize: 15 },
  multi: { minHeight: 70, paddingTop: space.s, textAlignVertical: 'top' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  step: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontFamily: font.bold, fontSize: 20 },
  goal: { fontFamily: font.display, fontSize: 22, minWidth: 30, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: space.s, marginTop: space.m },
  btn: { flex: 1, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: font.semibold, fontSize: 14 },
});
