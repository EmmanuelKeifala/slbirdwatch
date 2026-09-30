import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/components/Pressable';
import { SafeAreaView } from 'react-native-safe-area-context';

import { myBlocks, unblockUser } from '@/api';
import { useAuth } from '@/state/auth';
import { ScreenHeader } from '@/components/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

/** COM-05: people you've blocked, with unblock. */
export default function Blocked() {
  const c = useColors();
  const { session } = useAuth();
  const token = session?.token;
  const [people, setPeople] = useState<{ id: number; display_name: string }[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (token) myBlocks(token).then((r) => setPeople(r.items)).catch(() => setPeople([]));
    }, [token]),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Blocked people" back />
      <ScrollView contentContainerStyle={styles.content}>
        {people === null ? (
          <ActivityIndicator color={c.accent} />
        ) : people.length === 0 ? (
          <Text style={[styles.muted, { color: c.inkMuted }]}>You haven’t blocked anyone.</Text>
        ) : (
          people.map((p) => (
            <View key={p.id} style={[styles.row, { borderColor: c.border }]}>
              <Text style={[styles.name, { color: c.ink }]}>{p.display_name}</Text>
              <Pressable
                onPress={() => unblockUser(token!, p.id).then(() => setPeople(people.filter((x) => x.id !== p.id)))}
                accessibilityRole="button"
              >
                <Text style={[styles.unblock, { color: c.accentDeep }]}>Unblock</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.m },
  muted: { fontFamily: font.regular, fontSize: 15, textAlign: 'center', marginTop: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderRadius: radius.tile, padding: space.l },
  name: { fontFamily: font.semibold, fontSize: 15 },
  unblock: { fontFamily: font.semibold, fontSize: 14 },
});
