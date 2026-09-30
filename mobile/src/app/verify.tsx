import { Redirect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { verifyQueue } from '@/api';
import { useAuth } from '@/state/auth';
import { ObservationGrid } from '@/components/ObservationGrid';
import { ScreenHeader } from '@/components/ScreenHeader';
import { font, space, useColors } from '@/theme';

const VERIFIERS = ['verifier', 'moderator', 'admin'];

/** VER-03: sightings awaiting expert confirmation. */
export default function Verify() {
  const c = useColors();
  const { session } = useAuth();
  const [photosOnly, setPhotosOnly] = useState(false);
  const [unusualOnly, setUnusualOnly] = useState(false); // VER-08
  const token = session?.token;
  const load = useCallback((offset: number) => verifyQueue(token!, photosOnly, offset, unusualOnly), [token, photosOnly, unusualOnly]);

  if (!session || !VERIFIERS.includes(session.user.role)) return <Redirect href="/" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Review queue" back />
      <View style={styles.filter}>
        <Text style={[styles.filterText, { color: c.ink }]}>With photos only</Text>
        <Switch value={photosOnly} onValueChange={setPhotosOnly} trackColor={{ true: c.accent, false: c.border }} />
      </View>
      <View style={styles.filter}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.filterText, { color: c.ink }]}>Unusual only</Text>
          <Text style={[styles.hint, { color: c.inkMuted }]}>Out of range or season: only a verifier can settle these</Text>
        </View>
        <Switch value={unusualOnly} onValueChange={setUnusualOnly} trackColor={{ true: c.accent, false: c.border }} />
      </View>
      <ObservationGrid key={`${photosOnly}-${unusualOnly}`} load={load} empty="Nothing waiting for review." />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.screen,
    paddingBottom: space.l,
  },
  filterText: { fontFamily: font.semibold, fontSize: 15 },
  hint: { fontFamily: font.medium, fontSize: 12 },
});
