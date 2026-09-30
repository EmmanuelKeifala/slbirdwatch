import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { leaderboard, mediaUrl, type BoardRow } from '@/api';
import { useAuth } from '@/auth';
import { Pressable } from '@/Pressable';
import { ScreenHeader } from '@/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';
import { roughPosition } from '@/location';

const MEDAL = ['#F4B400', '#A7A9B8', '#C98A4B'];

/** GAM-05: XP earned this week, everyone or near you. */
export default function Leaderboard() {
  const c = useColors();
  const { session } = useAuth();
  const token = session?.token;
  const [scope, setScope] = useState<'week' | 'near'>('week');
  const [data, setData] = useState<{ items: BoardRow[]; ends: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      setNow(Date.now());
      (async () => {
        let near: { lat: number; lng: number } | undefined;
        if (scope === 'near') {
          try {
            if (!(await Location.requestForegroundPermissionsAsync()).granted) throw new Error();
            const pos = await roughPosition();
            near = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setNote(null);
          } catch {
            near = { lat: 8.484, lng: -13.234 };
            setNote('Allow location to see people near you. Showing Freetown.');
          }
        }
        const r = await leaderboard(scope, token, near).catch(() => null);
        if (live) setData(r ?? { items: [], ends: '' });
      })();
      return () => {
        live = false;
      };
    }, [scope, token]),
  );

  const days = data?.ends ? Math.max(1, Math.ceil((new Date(data.ends).getTime() - now) / 86400000)) : null;
  const me = data?.items.find((r) => r.me);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Leaderboard" back />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.tabs}>
          {(['week', 'near'] as const).map((s) => (
            <Pressable
              key={s}
              onPress={() => {
                setData(null);
                setScope(s);
              }}
              style={[styles.tab, { backgroundColor: s === scope ? c.primary : c.field }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: s === scope }}
            >
              <Text style={[styles.tabText, { color: s === scope ? c.onPrimary : c.ink }]}>{s === 'week' ? 'Everyone' : 'Near me'}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.note, { color: c.inkMuted }]}>
          XP earned this week{days ? `, ${days} day${days === 1 ? '' : 's'} to go` : ''}.{' '}
          {scope === 'near' ? 'People with a verified sighting within 50 km this week.' : ''}
        </Text>
        {!!note && <Text style={[styles.note, { color: c.wrong }]}>{note}</Text>}
        {session && !me && data && (
          <Text style={[styles.note, { color: c.inkMuted }]}>
            {session.user.hide_from_leaderboards || session.user.private_profile
              ? 'You’re hidden from leaderboards (Profile → Privacy).'
              : 'You’re not on the board yet this week: verified sightings, confirmed IDs and quizzes all count.'}
          </Text>
        )}

        {!data ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
        ) : data.items.length === 0 ? (
          <Text style={[styles.empty, { color: c.inkMuted }]}>No XP earned here yet this week. Be the first!</Text>
        ) : (
          data.items.map((r) => (
            <View
              key={r.user.id}
              style={[styles.row, { borderColor: r.me ? c.accent : c.border, backgroundColor: r.me ? c.tint : c.bg }]}
              accessible
              accessibilityLabel={`Number ${r.rank}, ${r.user.display_name}${r.me ? ' (you)' : ''}, ${r.xp} XP`}
            >
              <View style={[styles.rank, { backgroundColor: r.rank <= 3 ? MEDAL[r.rank - 1] : c.field }]}>
                <Text style={[styles.rankText, { color: r.rank <= 3 ? '#FFFFFF' : c.ink }]}>{r.rank}</Text>
              </View>
              {r.user.avatar_url ? (
                <Image source={{ uri: mediaUrl(r.user.avatar_url) }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: c.field, alignItems: 'center', justifyContent: 'center' }]}>
                  <Feather name="user" size={18} color={c.inkFaint} />
                </View>
              )}
              <Text style={[styles.name, { color: c.ink }]} numberOfLines={1}>
                {r.user.display_name}
                {r.me ? ' (you)' : ''}
              </Text>
              <Text style={[styles.xp, { color: c.ink }]}>{r.xp} XP</Text>
            </View>
          ))
        )}
        {!session && (
          <Pressable onPress={() => router.push('/sign-in')} accessibilityRole="button">
            <Text style={[styles.link, { color: c.accentDeep }]}>Sign in to join the board</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.s, paddingBottom: space.xxl * 2 },
  tabs: { flexDirection: 'row', gap: space.s, marginBottom: space.s },
  tab: { flex: 1, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontFamily: font.semibold, fontSize: 14 },
  note: { fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  empty: { fontFamily: font.medium, fontSize: 14, textAlign: 'center', marginTop: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderWidth: 1.5, borderRadius: radius.tile, padding: space.m },
  rank: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontFamily: font.bold, fontSize: 14 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  name: { flex: 1, fontFamily: font.semibold, fontSize: 15 },
  xp: { fontFamily: font.display, fontSize: 16 },
  link: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center', marginTop: space.l },
});
