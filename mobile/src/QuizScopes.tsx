import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getFeatureFields } from '@/api';
import { signInFirst } from '@/nav';
import { Pressable } from '@/Pressable';
import { font, radius, space, useColors } from '@/theme';
import { roughPosition } from '@/location';

type Icon = ComponentProps<typeof Feather>['name'];

/** QZ-04: quick quizzes by place, life list, season and habitat. */
export function QuizScopes({ signedIn }: { signedIn: boolean }) {
  const c = useColors();
  const [habitats, setHabitats] = useState<{ value: string; label: string }[]>([]);
  const [locating, setLocating] = useState(false);
  useEffect(() => {
    getFeatureFields().then((f) => setHabitats(f.find((x) => x.key === 'habitat')?.options ?? []), () => {});
  }, []);

  async function nearMe() {
    setLocating(true);
    try {
      if (!(await Location.requestForegroundPermissionsAsync()).granted) throw new Error('Allow location to quiz on the birds around you.');
      const pos = await roughPosition();
      router.push({ pathname: '/quiz', params: { scope: 'near', lat: String(pos.coords.latitude), lng: String(pos.coords.longitude) } });
    } catch (e) {
      Alert.alert('Location needed', e instanceof Error ? e.message : String(e));
    } finally {
      setLocating(false);
    }
  }

  const chip = (key: string, icon: Icon, label: string, onPress: () => void) => (
    <Pressable key={key} style={[styles.chip, { backgroundColor: c.field }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Quiz: ${label}`}>
      <Feather name={icon} size={14} color={c.accentDeep} />
      <Text style={[styles.chipText, { color: c.ink }]}>{label}</Text>
    </Pressable>
  );
  const month = new Date().getMonth() + 1;
  const nowSeason = month >= 5 && month <= 10 ? 'rainy' : 'dry';

  return (
    <View style={{ gap: space.s }}>
      <Text style={[styles.h, { color: c.ink }]}>Quiz by…</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
        {chip('near', 'map-pin', locating ? 'Finding you…' : 'Birds near me', nearMe)}
        {chip('life', 'check-circle', 'My life list', () =>
          signedIn ? router.push({ pathname: '/quiz', params: { scope: 'lifelist' } }) : signInFirst('Sign in to quiz on your life list.'),
        )}
        {(['rainy', 'dry'] as const).map((s) =>
          chip(s, s === 'rainy' ? 'cloud-rain' : 'sun', `${s === 'rainy' ? 'Rainy' : 'Dry'} season${s === nowSeason ? ' (now)' : ''}`, () =>
            router.push({ pathname: '/quiz', params: { season: s } }),
          ),
        )}
        {habitats.map((h) => chip(h.value, 'feather', h.label.replace(/\s*\(.*\)$/, ''), () => router.push({ pathname: '/quiz', params: { habitat: h.value } })))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  h: { fontFamily: font.bold, fontSize: 16 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: space.m, height: 38 },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
});
