import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { activityFeed, myFollowing } from '@/api';
import { useAuth } from '@/auth';
import { signInFirst } from '@/nav';
import { roughPosition } from '@/location';
import { ObservationGrid } from '@/ObservationGrid';
import { Pressable } from '@/Pressable';
import { ScreenHeader } from '@/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

const FREETOWN = { lat: 8.484, lng: -13.234 };
type Scope = 'near' | 'following';

/** COM-01: recent verified sightings near you, or from people you follow. */
export default function Activity() {
  const c = useColors();
  const token = useAuth().session?.token;
  const [scope, setScope] = useState<Scope>('near');
  const [spot, setSpot] = useState<{ lat: number; lng: number; mine: boolean } | null>(null);
  const [following, setFollowing] = useState<string[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!(await Location.requestForegroundPermissionsAsync()).granted) throw new Error();
        const pos = await roughPosition(); // the feed covers 25 km, so a rough, quick position will do
        setSpot({ lat: pos.coords.latitude, lng: pos.coords.longitude, mine: true });
      } catch {
        setSpot({ ...FREETOWN, mine: false });
      }
    })();
    if (token) myFollowing(token).then((r) => setFollowing(r.items.map((p) => p.display_name)), () => setFollowing([]));
  }, [token]);

  const load = useCallback(
    (offset: number) => activityFeed(scope, offset, { near: scope === 'near' ? (spot ?? FREETOWN) : undefined, token }),
    [scope, spot, token],
  );
  const pick = (s: Scope) => (s === 'following' && !token ? signInFirst('Sign in to follow other birders.') : setScope(s));

  const header = (
    <View style={{ gap: space.m, marginBottom: space.m }}>
      <View style={styles.tabs}>
        {(['near', 'following'] as const).map((s) => {
          const on = s === scope;
          return (
            <Pressable
              key={s}
              onPress={() => pick(s)}
              style={[styles.tab, { backgroundColor: on ? c.primary : c.field }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Feather name={s === 'near' ? 'map-pin' : 'users'} size={15} color={on ? c.onPrimary : c.ink} />
              <Text style={[styles.tabText, { color: on ? c.onPrimary : c.ink }]}>{s === 'near' ? 'Near me' : 'Following'}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.note, { color: c.inkMuted }]}>
        {scope === 'near'
          ? `Verified sightings within 25 km of ${spot?.mine ? 'you' : 'Freetown (allow location to use where you are)'}. Sensitive birds are left out.`
          : following?.length
            ? `Verified sightings from ${following.slice(0, 3).join(', ')}${following.length > 3 ? ` and ${following.length - 3} more` : ''}.`
            : 'Follow birders from their sightings to see what they find here.'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Activity" back />
      {spot && (
        <ObservationGrid
          key={scope} // fresh list per tab
          load={load}
          header={header}
          empty={scope === 'near' ? 'No verified sightings around here yet.' : 'Nothing yet from the people you follow.'}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: space.s, marginTop: space.s },
  tab: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 42, borderRadius: radius.pill },
  tabText: { fontFamily: font.semibold, fontSize: 14 },
  note: { fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
});
