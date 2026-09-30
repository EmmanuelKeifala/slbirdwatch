import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { listEvents, type BirdEvent } from '@/api';
import { Pressable } from '@/components/Pressable';
import { font, radius, space } from '@/theme';

export const whenText = (e: BirdEvent, now: number) => {
  const start = new Date(e.starts_at).getTime();
  const end = new Date(e.ends_at).getTime();
  const days = (ms: number) => Math.max(1, Math.ceil(ms / 86400000));
  if (now < start) return days(start - now) === 1 ? 'Starts tomorrow' : `Starts in ${days(start - now)} days`;
  if (now < end) return end - now < 86400000 ? 'On now · ends today' : `On now · ${days(end - now)} days left`;
  return 'Finished';
};

/** GAM-06: the running or next seasonal event, on Learn. */
export function EventBanner({ token }: { token?: string }) {
  const [e, setE] = useState<BirdEvent | null>(null);
  const [now, setNow] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      listEvents(token).then(
        (r) => setE(r.items.find((x) => new Date(x.ends_at).getTime() > Date.now()) ?? null),
        () => {},
      );
    }, [token]),
  );
  if (!e) return null;
  const live = now >= new Date(e.starts_at).getTime();
  return (
    <Pressable
      onPress={() => router.push(`/event/${e.slug}`)}
      accessibilityRole="button"
      accessibilityLabel={`${e.title}. ${whenText(e, now)}`}
    >
      <LinearGradient colors={['#F4B400', '#E0701B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.kicker}>{live ? 'SEASONAL EVENT · LIVE' : 'SEASONAL EVENT'}</Text>
          <Text style={styles.title}>{e.title}</Text>
          <Text style={styles.body}>
            {whenText(e, now)}
            {live ? ` · ${e.species} species so far` : ''}
            {live && e.mine !== null ? ` · you: ${e.mine}` : ''}
          </Text>
        </View>
        <Feather name="sunrise" size={40} color="#FFFFFF" />
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderRadius: radius.card, padding: space.l },
  kicker: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1, color: '#FFF4D6' },
  title: { fontFamily: font.display, fontSize: 22, color: '#FFFFFF' },
  body: { fontFamily: font.semibold, fontSize: 13, color: '#FFFFFF' },
});
