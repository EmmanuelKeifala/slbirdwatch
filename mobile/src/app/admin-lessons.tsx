import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { adminLessons, putLesson, type AdminLesson } from '@/api';
import { useAuth } from '@/state/auth';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

/** ADM-05 (admins): the lessons on Learn, in order. Tap one to edit; arrows move it. */
export default function AdminLessons() {
  const c = useColors();
  const token = useAuth().session!.token;
  const [items, setItems] = useState<AdminLesson[] | null>(null);
  const load = useCallback(() => {
    adminLessons(token).then((r) => setItems(r.items), () => setItems([]));
  }, [token]);
  useFocusEffect(load);

  // swap with a neighbour, then renumber everything 0..n so positions stay tidy
  const move = async (i: number, by: -1 | 1) => {
    if (!items) return;
    const next = [...items];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    const numbered = next.map((l, k) => ({ ...l, position: k }));
    setItems(numbered);
    try {
      await Promise.all(numbered.filter((l, k) => items[k]?.slug !== l.slug).map((l) => putLesson(token, l)));
    } catch (e) {
      Alert.alert('Couldn’t reorder', e instanceof Error ? e.message : String(e));
      load();
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Lessons" back />
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          style={[styles.add, { borderColor: c.primary }]}
          onPress={() => router.push({ pathname: '/admin-lesson', params: { position: String(items?.length ?? 0) } })}
          accessibilityRole="button"
        >
          <Feather name="plus" size={18} color={c.ink} />
          <Text style={[styles.addText, { color: c.ink }]}>New lesson</Text>
        </Pressable>
        {items === null ? (
          <ActivityIndicator color={c.accent} />
        ) : (
          items.map((l, i) => (
            <View key={l.slug} style={[styles.row, { borderColor: c.border }]}>
              <Pressable
                style={{ flex: 1, gap: 2 }}
                onPress={() => router.push({ pathname: '/admin-lesson', params: { slug: l.slug } })}
                accessibilityRole="button"
              >
                <Text style={[styles.title, { color: c.ink }]}>
                  {l.title}
                  {!l.published && <Text style={{ color: c.wrong }}> · hidden</Text>}
                </Text>
                <Text style={[styles.hint, { color: c.inkMuted }]} numberOfLines={1}>
                  {l.species_ids.length
                    ? `${l.species_ids.length} chosen birds`
                    : l.families.length
                      ? l.families.join(', ')
                      : 'Most recorded birds'}
                </Text>
              </Pressable>
              <Pressable disabled={i === 0} onPress={() => move(i, -1)} hitSlop={8} accessibilityLabel={`Move ${l.title} up`}>
                <Feather name="chevron-up" size={22} color={i === 0 ? c.border : c.ink} />
              </Pressable>
              <Pressable disabled={i === items.length - 1} onPress={() => move(i, 1)} hitSlop={8} accessibilityLabel={`Move ${l.title} down`}>
                <Feather name="chevron-down" size={22} color={i === items.length - 1 ? c.border : c.ink} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.s, paddingBottom: space.xxl * 2 },
  add: { flexDirection: 'row', gap: space.s, alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: radius.pill, borderWidth: 1.5, borderStyle: 'dashed', marginBottom: space.s },
  addText: { fontFamily: font.semibold, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderWidth: 1, borderRadius: radius.tile, padding: space.m },
  title: { fontFamily: font.bold, fontSize: 15 },
  hint: { fontFamily: font.medium, fontSize: 12 },
});
