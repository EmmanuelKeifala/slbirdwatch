import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getRareAlerts, putRareAlerts, type RareAlerts } from '@/api';
import { useAuth } from '@/auth';
import { Pressable } from '@/Pressable';
import { ScreenHeader } from '@/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';
import { roughPosition } from '@/location';

const RADII = [10, 25, 50];

/** COM-04 / NTF-03: opt in to hear when a rare bird is verified near you. */
export default function Alerts() {
  const c = useColors();
  const token = useAuth().session!.token;
  const [a, setA] = useState<RareAlerts | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getRareAlerts(token).then(setA, () => setA({ on: false, lat: null, lng: null, km: 25 }));
  }, [token]);

  const save = async (next: RareAlerts, locate: boolean) => {
    setBusy(true);
    try {
      if (locate) {
        if (!(await Location.requestForegroundPermissionsAsync()).granted)
          throw new Error('Allow location so we know which area to watch.');
        const pos = await roughPosition();
        // a couple of decimals is plenty for an alert area, and keeps your exact spot off our servers
        next = { ...next, lat: Math.round(pos.coords.latitude * 100) / 100, lng: Math.round(pos.coords.longitude * 100) / 100 };
      }
      setA(await putRareAlerts(token, next));
    } catch (e) {
      Alert.alert('Couldn’t save', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Rare bird alerts" back />
      {!a ? (
        <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.hero, { backgroundColor: c.tint }]}>
            <Feather name="star" size={24} color={c.tintIcon} />
            <Text style={[styles.body, { color: c.ink }]}>
              Hear when a bird that’s rare in Sierra Leone, or out of its usual season, is verified in your area. Sensitive species never
              send alerts, and alerts never say exactly where.
            </Text>
          </View>
          <View style={[styles.card, { borderColor: c.border }]}>
            <View style={styles.row}>
              <Text style={[styles.title, { color: c.ink, flex: 1 }]}>Send me alerts</Text>
              <Switch
                value={a.on}
                disabled={busy}
                onValueChange={(on) => save({ ...a, on }, on && a.lat === null)}
                trackColor={{ true: c.accent, false: c.border }}
              />
            </View>
            {a.lat !== null && (
              <Text style={[styles.meta, { color: c.inkMuted }]}>
                Area: around the place you set ({a.lat.toFixed(2)}, {a.lng?.toFixed(2)})
              </Text>
            )}
          </View>
          <Text style={[styles.title, { color: c.ink }]}>How far</Text>
          <View style={styles.row}>
            {RADII.map((km) => (
              <Pressable
                key={km}
                disabled={busy}
                onPress={() => save({ ...a, km }, false)}
                style={[styles.chip, { backgroundColor: a.km === km ? c.primary : c.field }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: a.km === km }}
              >
                <Text style={[styles.chipText, { color: a.km === km ? c.onPrimary : c.ink }]}>{km} km</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={[styles.secondary, { borderColor: c.primary }]}
            disabled={busy}
            onPress={() => save(a, true)}
            accessibilityRole="button"
          >
            <Feather name="map-pin" size={16} color={c.ink} />
            <Text style={[styles.secondaryText, { color: c.ink }]}>
              {a.lat === null ? 'Use where I am now' : 'Move my area to where I am now'}
            </Text>
          </Pressable>
          {busy && <ActivityIndicator color={c.accent} />}
          <Text style={[styles.meta, { color: c.inkFaint }]}>
            Alerts arrive in your inbox, and as a push when notifications are allowed.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.l, paddingBottom: space.xxl * 2 },
  hero: { borderRadius: radius.card, padding: space.l, gap: space.m },
  body: { fontFamily: font.medium, fontSize: 14, lineHeight: 21 },
  card: { borderWidth: 1.5, borderRadius: radius.card, padding: space.l, gap: space.s },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  title: { fontFamily: font.bold, fontSize: 15 },
  meta: { fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.l, height: 38, justifyContent: 'center' },
  chipText: { fontFamily: font.semibold, fontSize: 14 },
  secondary: {
    flexDirection: 'row',
    gap: space.s,
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  secondaryText: { fontFamily: font.semibold, fontSize: 14 },
});
