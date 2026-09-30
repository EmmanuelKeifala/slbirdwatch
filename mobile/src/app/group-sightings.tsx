import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { groupSightings } from '@/api';
import { useAuth } from '@/auth';
import { ObservationGrid } from '@/ObservationGrid';
import { ScreenHeader } from '@/ScreenHeader';
import { useColors } from '@/theme';

/** COM-03: a group's members' verified sightings, newest first. */
export default function GroupSightings() {
  const c = useColors();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const token = useAuth().session!.token;
  const load = useCallback((offset: number) => groupSightings(token, Number(id), offset), [token, id]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title={name ?? 'Group sightings'} back />
      <ObservationGrid load={load} empty="No verified sightings from members yet." />
    </SafeAreaView>
  );
}
