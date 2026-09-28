import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/Pressable';
import { SafeAreaView } from 'react-native-safe-area-context';

import { feed, type Observation } from '@/api';
import { useAuth } from '@/auth';
import { ObservationGrid } from '@/ObservationGrid';
import { ScreenHeader } from '@/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

const TABS: { status: Observation['status']; label: string }[] = [
  { status: 'needs_id', label: 'Needs ID' },
  { status: 'community', label: 'Community ID' },
  { status: 'verified', label: 'Verified' },
];

/** Help identify: other people's sightings by status (VER-01). */
export default function Identify() {
  const c = useColors();
  const { session } = useAuth();
  const [status, setStatus] = useState<Observation['status']>('needs_id');
  const token = session?.token;
  const load = useCallback((offset: number) => feed(status, offset, token), [status, token]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Help identify" back />
      <View style={styles.tabs}>
        {TABS.map((t) => {
          const on = t.status === status;
          return (
            <Pressable
              key={t.status}
              style={[styles.tab, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent : c.bg }]}
              onPress={() => setStatus(t.status)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabText, { color: on ? c.onAccent : c.ink }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <ObservationGrid
        key={status}
        load={load}
        empty={status === 'needs_id' ? 'Nothing waiting for an ID right now.' : 'Nothing here yet.'}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: space.s, paddingHorizontal: space.screen, paddingBottom: space.l },
  tab: { flex: 1, height: 38, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontFamily: font.semibold, fontSize: 13 },
});
