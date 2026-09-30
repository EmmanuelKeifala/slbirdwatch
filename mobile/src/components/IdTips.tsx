import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { deleteTip, isVerifier, speciesTips, type IdTip } from '@/api';
import { useAuth } from '@/state/auth';
import { Pressable } from '@/components/Pressable';
import { font, radius, space, useColors } from '@/theme';

/** LIB-10: expert tips on knowing this bird, and telling it from lookalikes. Verifiers write and edit them. */
export function IdTips({ speciesId, name, title }: { speciesId: number; name: string; title: (t: string) => React.ReactNode }) {
  const c = useColors();
  const { session } = useAuth();
  const expert = isVerifier(session?.user);
  const [tips, setTips] = useState<IdTip[]>([]);

  const load = useCallback(() => {
    speciesTips(speciesId).then((r) => setTips(r.items), () => {});
  }, [speciesId]);
  useFocusEffect(load); // back from the editor: show the saved tip

  if (!tips.length && !expert) return null;

  // the editor is a full screen (app/tip.tsx), so its text box never sits behind the keyboard
  const edit = (otherId: number | null) =>
    router.push({ pathname: '/tip', params: { species: String(speciesId), name, ...(otherId ? { other: String(otherId) } : {}) } });
  const remove = (t: IdTip) =>
    Alert.alert('Delete this tip?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteTip(session!.token, t.id).then(load, () => {}) },
    ]);

  return (
    <View style={{ gap: space.m }}>
      {title('How to tell it apart')}
      {tips.map((t) => (
        <View key={t.id} style={[styles.card, { backgroundColor: t.other ? c.surface : c.tint, borderColor: c.border }]}>
          <View style={styles.head}>
            <Feather name={t.other ? 'columns' : 'eye'} size={16} color={c.accentDeep} />
            <Text style={[styles.headText, { color: c.ink }]}>{t.other ? `vs ${t.other.english_name}` : `Knowing a ${name}`}</Text>
          </View>
          <Text style={[styles.body, { color: c.ink }]}>{t.text}</Text>
          <View style={styles.foot}>
            <Text style={[styles.by, { color: c.inkFaint }]}>Tip by {t.author || 'an expert'}</Text>
            {t.other && (
              <Pressable
                onPress={() => router.push({ pathname: '/compare', params: { ids: `${speciesId},${t.other!.id}` } })}
                accessibilityRole="button"
              >
                <Text style={[styles.link, { color: c.accentDeep }]}>Compare</Text>
              </Pressable>
            )}
            {expert && (
              <>
                <Pressable onPress={() => edit(t.other?.id ?? null)} accessibilityRole="button">
                  <Text style={[styles.link, { color: c.accentDeep }]}>Edit</Text>
                </Pressable>
                <Pressable onPress={() => remove(t)} accessibilityRole="button">
                  <Text style={[styles.link, { color: c.wrong }]}>Delete</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      ))}
      {expert && (
        <Pressable
          style={[styles.add, { borderColor: c.primary }]}
          onPress={() => edit(null)}
          accessibilityRole="button"
        >
          <Feather name="edit-3" size={16} color={c.ink} />
          <Text style={[styles.addText, { color: c.ink }]}>Write an ID tip</Text>
        </Pressable>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, borderWidth: 1, padding: space.l, gap: space.s },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  headText: { fontFamily: font.bold, fontSize: 15, flex: 1 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  by: { fontFamily: font.medium, fontSize: 12, flex: 1 },
  link: { fontFamily: font.semibold, fontSize: 13 },
  add: { flexDirection: 'row', gap: space.s, alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: radius.pill, borderWidth: 1.5, borderStyle: 'dashed' },
  addText: { fontFamily: font.semibold, fontSize: 14 },
});
