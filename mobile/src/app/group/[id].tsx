import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addGroupChallenge, deleteGroup, getGroup, leaveGroup, newGroupCode, type GroupDetail } from '@/api';
import { useAuth } from '@/state/auth';
import { FormScroll } from '@/components/FormScroll';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

/** COM-03 / GAM-07: one group: its code, private board, challenges, outings, sightings and quiz. */
export default function GroupScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const token = session!.token;
  const [d, setD] = useState<GroupDetail | null>(null);
  const [error, setError] = useState(false);
  const [goal, setGoal] = useState<{ title: string; goal: string; days: number } | null>(null);
  const [now, setNow] = useState(0); // the clock, read when loading, not while drawing
  const load = useCallback(() => {
    setNow(Date.now());
    getGroup(token, Number(id)).then(setD, () => setError(true));
  }, [token, id]);
  useFocusEffect(load);

  if (!d) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <ScreenHeader title="Group" back />
        {error ? (
          <Text style={[styles.meta, { color: c.inkMuted, padding: space.screen }]}>This group isn’t available.</Text>
        ) : (
          <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
        )}
      </SafeAreaView>
    );
  }
  const g = d.group;
  const owner = g.owner_id === session!.user.id;
  const share = () =>
    Share.share({ message: `Join ${g.name} on SL Birdwatch: open Profile → Groups & clubs and enter the code ${g.join_code}` }).catch(
      () => {},
    );
  const confirm = (title: string, text: string, action: string, fn: () => Promise<unknown>, after: () => void) =>
    Alert.alert(title, text, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action,
        style: 'destructive',
        onPress: () => fn().then(after, (e) => Alert.alert('That didn’t work', e instanceof Error ? e.message : String(e))),
      },
    ]);
  const saveGoal = () => {
    if (!goal) return;
    const start = new Date();
    const end = new Date(start.getTime() + goal.days * 86400000);
    addGroupChallenge(token, g.id, {
      title: goal.title.trim(),
      goal: Number(goal.goal),
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
    }).then(
      () => {
        setGoal(null);
        load();
      },
      (e) => Alert.alert('Couldn’t set the challenge', e instanceof Error ? e.message : String(e)),
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title={g.name} back />
      <FormScroll contentContainerStyle={styles.content}>
        {!!g.description && <Text style={[styles.body, { color: c.inkMuted }]}>{g.description}</Text>}

        <View style={[styles.codeCard, { backgroundColor: c.tint }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.meta, { color: c.inkMuted }]}>Join code</Text>
            <Text style={[styles.code, { color: c.ink }]}>{g.join_code}</Text>
          </View>
          <Pressable onPress={share} style={[styles.pill, { backgroundColor: c.primary }]} accessibilityRole="button">
            <Feather name="share-2" size={15} color={c.onPrimary} />
            <Text style={[styles.pillText, { color: c.onPrimary }]}>Invite</Text>
          </Pressable>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={[styles.action, { backgroundColor: c.field }]}
            onPress={() => router.push({ pathname: '/quiz', params: { scope: 'group', group: String(g.id) } })}
            accessibilityRole="button"
          >
            <Feather name="help-circle" size={18} color={c.accentDeep} />
            <Text style={[styles.actionText, { color: c.ink }]}>Group quiz</Text>
          </Pressable>
          <Pressable
            style={[styles.action, { backgroundColor: c.field }]}
            onPress={() => router.push({ pathname: '/group-sightings', params: { id: String(g.id), name: g.name } })}
            accessibilityRole="button"
          >
            <Feather name="image" size={18} color={c.accentDeep} />
            <Text style={[styles.actionText, { color: c.ink }]}>Sightings</Text>
          </Pressable>
        </View>

        <Text style={[styles.h2, { color: c.ink }]}>Challenges</Text>
        {d.challenges.length === 0 && !goal && (
          <Text style={[styles.meta, { color: c.inkMuted }]}>
            {owner ? 'Set a target for the group, like 50 species this month.' : 'No challenge yet.'}
          </Text>
        )}
        {d.challenges.map((ch) => {
          const done = ch.species >= ch.goal;
          const ended = new Date(ch.ends_at).getTime() < now;
          return (
            <View key={ch.id} style={[styles.card, { borderColor: done ? c.correct : c.border }]}>
              <Text style={[styles.title, { color: c.ink }]}>{ch.title}</Text>
              <View style={[styles.bar, { backgroundColor: c.field }]}>
                <View
                  style={[
                    styles.fill,
                    { backgroundColor: done ? c.correct : c.accent, width: `${Math.min(100, (100 * ch.species) / ch.goal)}%` },
                  ]}
                />
              </View>
              <Text style={[styles.meta, { color: c.inkMuted }]}>
                {ch.species} of {ch.goal} species together ·{' '}
                {ended ? 'finished' : `until ${new Date(ch.ends_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
              </Text>
            </View>
          );
        })}
        {owner &&
          (goal ? (
            <View style={[styles.card, { borderColor: c.border, gap: space.s }]}>
              <TextInput
                style={[styles.input, { color: c.ink, backgroundColor: c.field }]}
                value={goal.title}
                onChangeText={(title) => setGoal({ ...goal, title })}
                placeholder="Title, e.g. 50 species in October"
                placeholderTextColor={c.inkFaint}
                maxLength={60}
              />
              <TextInput
                style={[styles.input, { color: c.ink, backgroundColor: c.field }]}
                value={goal.goal}
                onChangeText={(t) => setGoal({ ...goal, goal: t.replace(/[^0-9]/g, '').slice(0, 4) })}
                placeholder="How many species between you"
                placeholderTextColor={c.inkFaint}
                keyboardType="number-pad"
              />
              <View style={styles.actions}>
                {[7, 30, 90].map((days) => (
                  <Pressable
                    key={days}
                    onPress={() => setGoal({ ...goal, days })}
                    style={[styles.chip, { backgroundColor: goal.days === days ? c.primary : c.field }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: goal.days === days }}
                  >
                    <Text style={[styles.chipText, { color: goal.days === days ? c.onPrimary : c.ink }]}>{days} days</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                style={[
                  styles.pill,
                  { backgroundColor: c.primary, alignSelf: 'stretch', justifyContent: 'center' },
                  (goal.title.trim().length < 2 || !Number(goal.goal)) && { opacity: 0.4 },
                ]}
                disabled={goal.title.trim().length < 2 || !Number(goal.goal)}
                onPress={saveGoal}
                accessibilityRole="button"
              >
                <Text style={[styles.pillText, { color: c.onPrimary }]}>Set challenge</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setGoal({ title: '', goal: '', days: 30 })} accessibilityRole="button">
              <Text style={[styles.link, { color: c.accentDeep }]}>＋ New group challenge</Text>
            </Pressable>
          ))}

        <Text style={[styles.h2, { color: c.ink }]}>This week</Text>
        <Text style={[styles.meta, { color: c.inkMuted }]}>XP earned this week. Only members see this board.</Text>
        {d.members.map((m, i) => (
          <Pressable
            key={m.id}
            style={[styles.member, { borderColor: c.border }]}
            onLongPress={
              owner && !m.owner
                ? () =>
                    confirm(
                      `Remove ${m.display_name}?`,
                      'They can rejoin with the code.',
                      'Remove',
                      () => leaveGroup(token, g.id, m.id),
                      load,
                    )
                : undefined
            }
            accessibilityLabel={`${i + 1}. ${m.display_name}, ${m.week_xp} XP this week, ${m.species} species`}
          >
            <Text style={[styles.rank, { color: c.inkMuted }]}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.ink }]} numberOfLines={1}>
                {m.display_name}
                {m.owner ? ' · runs the group' : ''}
              </Text>
              <Text style={[styles.meta, { color: c.inkMuted }]}>{m.species} species on their life list</Text>
            </View>
            <Text style={[styles.xp, { color: c.ink }]}>{m.week_xp} XP</Text>
          </Pressable>
        ))}
        {owner && d.members.length > 1 && <Text style={[styles.meta, { color: c.inkFaint }]}>Press and hold a member to remove them.</Text>}

        {d.outings.length > 0 && (
          <>
            <Text style={[styles.h2, { color: c.ink }]}>Recent outings</Text>
            {d.outings.map((o) => (
              <View key={o.id} style={[styles.member, { borderColor: c.border }]}>
                <Feather name="map" size={18} color={c.accentDeep} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: c.ink }]}>{o.user.display_name}</Text>
                  <Text style={[styles.meta, { color: c.inkMuted }]}>
                    {new Date(o.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
                    {(o.distance_m / 1000).toFixed(1)} km · {o.species} species
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        <View style={{ marginTop: space.xl, gap: space.m }}>
          {owner && (
            <Pressable
              onPress={() =>
                confirm(
                  'New join code?',
                  'The old code stops working. People already in stay in.',
                  'New code',
                  () => newGroupCode(token, g.id),
                  load,
                )
              }
              accessibilityRole="button"
            >
              <Text style={[styles.link, { color: c.accentDeep }]}>Make a new join code</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() =>
              owner
                ? confirm(
                    `Delete ${g.name}?`,
                    'The group goes for everyone. Their sightings stay theirs.',
                    'Delete',
                    () => deleteGroup(token, g.id),
                    () => router.back(),
                  )
                : confirm(
                    `Leave ${g.name}?`,
                    'You can rejoin with the code.',
                    'Leave',
                    () => leaveGroup(token, g.id),
                    () => router.back(),
                  )
            }
            accessibilityRole="button"
          >
            <Text style={[styles.link, { color: c.wrong }]}>{owner ? 'Delete the group' : 'Leave the group'}</Text>
          </Pressable>
        </View>
      </FormScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  meta: { fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  codeCard: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.card, padding: space.l },
  code: { fontFamily: font.display, fontSize: 30, letterSpacing: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: space.l, height: 42 },
  pillText: { fontFamily: font.semibold, fontSize: 14 },
  actions: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  action: {
    flex: 1,
    flexDirection: 'row',
    gap: space.s,
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: radius.pill,
  },
  actionText: { fontFamily: font.semibold, fontSize: 14 },
  h2: { fontFamily: font.display, fontSize: 20, marginTop: space.m },
  card: { borderWidth: 1.5, borderRadius: radius.card, padding: space.m, gap: 6 },
  title: { fontFamily: font.bold, fontSize: 15 },
  bar: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
  input: { borderRadius: radius.tile, paddingHorizontal: space.l, minHeight: 46, fontFamily: font.regular, fontSize: 15 },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.m, height: 36, justifyContent: 'center' },
  chipText: { fontFamily: font.semibold, fontSize: 13 },
  link: { fontFamily: font.semibold, fontSize: 14 },
  member: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderBottomWidth: 1, paddingVertical: space.s },
  rank: { fontFamily: font.bold, fontSize: 14, width: 22 },
  xp: { fontFamily: font.display, fontSize: 16 },
});
