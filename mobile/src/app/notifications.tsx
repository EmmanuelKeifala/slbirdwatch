import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clearNotifications, deleteNotification, markNotificationsRead, myNotifications, type AppNotification } from '@/api';
import { useAuth } from '@/state/auth';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';
import { setUnread } from '@/state/unread';

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function text(n: AppNotification) {
  const bird = n.species?.english_name ?? 'a bird';
  if (n.kind === 'comment') return `${n.actor?.display_name ?? 'Someone'} commented on your sighting`;
  if (n.kind === 'reply') return `${n.actor?.display_name ?? 'Someone'} replied to your comment`;
  if (n.kind === 'rare') return `Rare bird nearby: ${bird} was verified within your alert area`;
  if (n.kind === 'identification') return `${n.actor?.display_name ?? 'Someone'} identified your sighting as ${bird}`;
  return n.status === 'verified' ? `A verifier confirmed your ${bird}` : `The community agreed your sighting is a ${bird}`;
}

/** NTF-01: what happened to your sightings. Opening the list marks everything read. */
export default function Notifications() {
  const c = useColors();
  const token = useAuth().session?.token;
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [next, setNext] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      myNotifications(token)
        .then((r) => {
          setItems(r.items);
          setNext(r.next_offset);
          if (r.unread) markNotificationsRead(token).then(() => setUnread(0), () => {});
        })
        .catch(() => setItems([]));
    }, [token]),
  );

  const more = () =>
    token &&
    next !== null &&
    myNotifications(token, next).then((r) => {
      setItems((prev) => [...(prev ?? []), ...r.items]);
      setNext(r.next_offset);
    });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader
        title="Notifications"
        back
        right={
          items?.length ? (
            <Pressable
              onPress={() =>
                Alert.alert('Clear all notifications?', undefined, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Clear all', style: 'destructive', onPress: () => token && clearNotifications(token).then(() => setItems([])) },
                ])
              }
              hitSlop={10}
              accessibilityRole="button"
            >
              <Text style={[styles.clear, { color: c.accentDeep }]}>Clear all</Text>
            </Pressable>
          ) : undefined
        }
      />
      {items === null ? (
        <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => String(n.id)}
          contentContainerStyle={styles.content}
          onEndReached={more}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="bell" size={40} color={c.tintIcon} />
              <Text style={[styles.emptyText, { color: c.inkMuted }]}>
                When someone identifies one of your sightings, or it gets confirmed, you’ll see it here.
              </Text>
            </View>
          }
          renderItem={({ item: n }) => (
            <Pressable
              style={[styles.row, { backgroundColor: n.read ? c.bg : c.field }]}
              onPress={() => router.push(`/sighting/${n.observation_id}`)}
              accessibilityRole="button"
            >
              <View style={[styles.icon, { backgroundColor: c.tint }]}>
                <Feather name={n.kind === 'rare' ? 'star' : n.kind === 'comment' || n.kind === 'reply' ? 'message-square' : n.kind === 'identification' ? 'message-circle' : n.status === 'verified' ? 'check-circle' : 'users'} size={18} color={c.tintIcon} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.text, { color: c.ink }]}>{text(n)}</Text>
                <Text style={[styles.time, { color: c.inkMuted }]}>{ago(n.created_at)}</Text>
              </View>
              {!n.read && <View style={[styles.dot, { backgroundColor: c.accent }]} />}
              <Pressable
                onPress={() => token && deleteNotification(token, n.id).then(() => setItems((l) => (l ?? []).filter((x) => x.id !== n.id)))}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Delete notification"
              >
                <Feather name="x" size={16} color={c.inkFaint} />
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.s, paddingBottom: space.xxl * 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderRadius: radius.tile, padding: space.m },
  icon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  time: { fontFamily: font.medium, fontSize: 12, marginTop: 2 },
  clear: { fontFamily: font.semibold, fontSize: 14 },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
  empty: { alignItems: 'center', gap: space.m, marginTop: space.xxl * 2, paddingHorizontal: space.xl },
  emptyText: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
