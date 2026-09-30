import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { myOutings, type OutingRow } from '@/api';
import { useAuth } from '@/state/auth';
import { cancelOuting, endOuting, startOuting, syncOutings, useOutingState } from '@/state/outing';
import { duration, km, routeLength } from '@/lib/outingMath';
import { Pressable } from '@/components/Pressable';
import { font, radius, space, useColors } from '@/theme';

/** OBS-10 on Your discoveries: start an outing, follow it live, end it; past outings underneath. */
export function OutingBar() {
  const c = useColors();
  const { session } = useAuth();
  const { active } = useOutingState();
  const [past, setPast] = useState<OutingRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const token = session?.token;

  useFocusEffect(
    useCallback(() => {
      if (token) myOutings(token).then((r) => setPast(r.items), () => {});
    }, [token]),
  );
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 30_000); // the clock on the banner
    return () => clearInterval(t);
  }, [active]);

  if (!session) return null;
  const onThisOuting = active?.logged ?? 0;

  const start = async () => {
    const err = await startOuting(session.user.id);
    if (err) Alert.alert('Can’t start an outing', err);
  };
  const end = () =>
    Alert.alert('End this outing?', 'Your route and sightings are saved and uploaded when you have signal.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Discard outing', style: 'destructive', onPress: cancelOuting },
      {
        text: 'End outing',
        onPress: async () => {
          endOuting();
          const id = await syncOutings(session.token, session.user.id);
          if (id) router.push(`/outing/${id}`);
          else Alert.alert('Outing saved', 'The summary will be ready once you’re back online.');
        },
      },
    ]);

  return (
    <View style={{ gap: space.m, marginBottom: space.l }}>
      {active ? (
        <LinearGradient colors={[c.night[0], c.night[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.live, styles.side]}>
          <View style={styles.liveHead}>
            <View style={styles.dot} />
            <Text style={styles.liveTitle}>Outing in progress</Text>
          </View>
          <View style={styles.numbers}>
            <Num value={duration(Math.max(0, Math.round((now - Date.parse(active.startedAt)) / 60000)))} label="time" />
            <Num value={km(routeLength(active.route))} label="walked" />
            <Num value={String(onThisOuting)} label={onThisOuting === 1 ? 'sighting' : 'sightings'} />
          </View>
          <View style={styles.actions}>
            <Pressable style={[styles.btn, { backgroundColor: '#FFFFFF' }]} onPress={() => router.push('/observe')} accessibilityRole="button">
              <Feather name="plus" size={16} color={c.ink} />
              <Text style={[styles.btnText, { color: c.ink }]}>Log a bird</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.ghost]} onPress={end} accessibilityRole="button">
              <Feather name="flag" size={16} color="#FFFFFF" />
              <Text style={[styles.btnText, { color: '#FFFFFF' }]}>End</Text>
            </Pressable>
          </View>
        </LinearGradient>
      ) : (
        <Pressable style={[styles.start, styles.side, { backgroundColor: c.tiles[1] }]} onPress={start} accessibilityRole="button">
          <View style={[styles.startIcon, { backgroundColor: 'rgba(255,255,255,0.75)' }]}>
            <Feather name="navigation" size={18} color={c.tintIcon} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.startTitle, { color: c.ink }]}>Start an outing</Text>
            <Text style={[styles.startHint, { color: c.inkMuted }]}>Record your route and log birds quickly as you walk</Text>
          </View>
          <Feather name="chevron-right" size={20} color={c.inkMuted} />
        </Pressable>
      )}

      {past.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.pastRow, styles.side]}>
          {past.map((o) => (
            <Pressable
              key={o.id}
              style={[styles.past, { borderColor: c.border }]}
              onPress={() => router.push(`/outing/${o.id}`)}
              accessibilityRole="button"
            >
              <Text style={[styles.pastDate, { color: c.ink }]}>
                {new Date(o.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
              </Text>
              <Text style={[styles.pastSub, { color: c.inkMuted }]}>
                {o.species} species · {km(o.distance_m)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function Num({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.numValue}>{value}</Text>
      <Text style={styles.numLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  side: {}, // the list around it already has the side padding
  live: { borderRadius: radius.card, padding: space.l, gap: space.m },
  liveHead: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#5BE38F' },
  liveTitle: { fontFamily: font.bold, fontSize: 13, color: '#E3E0FF', letterSpacing: 0.4 },
  numbers: { flexDirection: 'row', gap: space.m },
  numValue: { fontFamily: font.display, fontSize: 22, color: '#FFFFFF' },
  numLabel: { fontFamily: font.medium, fontSize: 12, color: '#C9C2FF' },
  actions: { flexDirection: 'row', gap: space.s },
  btn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: radius.pill },
  ghost: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)' },
  btnText: { fontFamily: font.semibold, fontSize: 14 },
  start: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderRadius: radius.card, padding: space.l },
  startIcon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  startTitle: { fontFamily: font.bold, fontSize: 16 },
  startHint: { fontFamily: font.regular, fontSize: 13, marginTop: 2 },
  pastRow: { gap: space.s },
  past: { borderWidth: 1.5, borderRadius: radius.tile, paddingHorizontal: space.m, paddingVertical: space.s },
  pastDate: { fontFamily: font.bold, fontSize: 13 },
  pastSub: { fontFamily: font.medium, fontSize: 12, marginTop: 2 },
});
