import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormScroll } from '@/FormScroll';
import { listSensitive, type SensitiveSpecies } from '@/api';
import { useAuth } from '@/auth';
import { Pressable } from '@/Pressable';
import { ScreenHeader } from '@/ScreenHeader';
import { SpeciesPicker } from '@/SpeciesPicker';
import { font, radius, space, useColors } from '@/theme';

/** ADM-03 (admins): sensitive species and how far their locations are blurred. Tap one to change it. */
export default function Sensitive() {
  const c = useColors();
  const token = useAuth().session!.token;
  const [items, setItems] = useState<SensitiveSpecies[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      listSensitive(token)
        .then((r) => setItems(r.items))
        .catch(() => setItems([]));
    }, [token]),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Sensitive species" back />
      <FormScroll contentContainerStyle={styles.content}>
        <Text style={[styles.lead, { color: c.inkMuted }]}>
          Sightings of these birds are shown to others only to the nearest area, to protect nests and roosts. Find a bird to add
          it.
        </Text>
        <SpeciesPicker value={undefined} onChange={(p) => p && router.push(`/species-admin/${p.id}`)} />
        {items === null ? (
          <ActivityIndicator color={c.accent} />
        ) : items.length === 0 ? (
          <Text style={[styles.lead, { color: c.inkMuted, textAlign: 'center' }]}>No sensitive species yet.</Text>
        ) : (
          items.map((s) => (
            <Pressable
              key={s.id}
              style={[styles.row, { borderColor: c.border }]}
              onPress={() => router.push(`/species-admin/${s.id}`)}
              accessibilityRole="button"
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: c.ink }]}>{s.english_name}</Text>
                <Text style={[styles.sub, { color: c.inkMuted }]}>
                  About {s.km} km{s.local ? ' · Sierra Leone bird' : ''}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={c.inkFaint} />
            </Pressable>
          ))
        )}
      </FormScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
  lead: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: radius.tile, padding: space.l },
  name: { fontFamily: font.semibold, fontSize: 15 },
  sub: { fontFamily: font.medium, fontSize: 13, marginTop: 2 },
});
