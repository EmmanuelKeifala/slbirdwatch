import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormScroll } from '@/FormScroll';
import { mediaUrl, moderateComment, moderatePerson, moderateSighting, modQueue, type FlaggedSighting, type ReportedComment, type ReportedPerson } from '@/api';
import { useAuth } from '@/auth';
import { Pressable } from '@/Pressable';
import { ScreenHeader } from '@/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

const pretty = (v: string) => v.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase());

/** ADM-01: flagged sightings and reported people, oldest first, with the actions a moderator can take. */
export default function Moderate() {
  const c = useColors();
  const token = useAuth().session?.token;
  const [tab, setTab] = useState<'sightings' | 'people' | 'comments'>('sightings');
  const [queue, setQueue] = useState<{ sightings: FlaggedSighting[]; people: ReportedPerson[]; comments: ReportedComment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    modQueue(token)
      .then(setQueue)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);
  useFocusEffect(load);

  const act = (run: () => Promise<void>, done: string) =>
    run()
      .then(() => {
        Alert.alert(done);
        load();
      })
      .catch((e) => Alert.alert('Couldn’t do that', e instanceof Error ? e.message : String(e)));

  const tabs = [
    { key: 'sightings' as const, label: `Sightings${queue ? ` (${queue.sightings.length})` : ''}` },
    { key: 'people' as const, label: `People${queue ? ` (${queue.people.length})` : ''}` },
    { key: 'comments' as const, label: `Comments${queue ? ` (${queue.comments.length})` : ''}` },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Moderation" back />
      <View style={styles.tabs}>
        {tabs.map((t) => {
          const on = t.key === tab;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent : c.bg }]}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabText, { color: on ? c.onAccent : c.ink }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <FormScroll contentContainerStyle={styles.content}>
        {!queue ? (
          error ? (
            <Text style={[styles.muted, { color: c.wrong }]}>{error}</Text>
          ) : (
            <ActivityIndicator color={c.accent} />
          )
        ) : tab === 'sightings' ? (
          queue.sightings.length === 0 ? (
            <Text style={[styles.muted, { color: c.inkMuted }]}>No flagged sightings. Nice.</Text>
          ) : (
            queue.sightings.map((s) => <SightingCard key={s.id} s={s} token={token!} act={act} />)
          )
        ) : tab === 'comments' ? (
          queue.comments.length === 0 ? (
            <Text style={[styles.muted, { color: c.inkMuted }]}>No reported comments.</Text>
          ) : (
            queue.comments.map((cm) => (
              <View key={cm.id} style={[styles.card, { borderColor: c.border }]}>
                <Text style={[styles.sub, { color: c.inkMuted }]}>
                  {cm.author.display_name}
                  {cm.hidden ? ' · hidden' : ''} · {cm.reports} report{cm.reports === 1 ? '' : 's'}
                </Text>
                <Text style={[styles.title, { color: c.ink }]}>“{cm.body}”</Text>
                <Reasons reasons={cm.reasons} notes={[]} />
                <Actions
                  items={[
                    { label: 'Open sighting', onPress: () => router.push(`/sighting/${cm.observation_id}`) },
                    cm.hidden
                      ? { label: 'Restore', onPress: () => act(() => moderateComment(token!, cm.id, 'restore'), 'Comment restored') }
                      : { label: 'Hide', onPress: () => act(() => moderateComment(token!, cm.id, 'hide'), 'Comment hidden') },
                    { label: 'Dismiss', onPress: () => act(() => moderateComment(token!, cm.id, 'dismiss'), 'Reports dismissed') },
                  ]}
                />
              </View>
            ))
          )
        ) : queue.people.length === 0 ? (
          <Text style={[styles.muted, { color: c.inkMuted }]}>No one has been reported.</Text>
        ) : (
          queue.people.map((p) => <PersonCard key={p.user.id} p={p} token={token!} act={act} />)
        )}
      </FormScroll>
    </SafeAreaView>
  );
}

type Act = (run: () => Promise<void>, done: string) => void;

function Reasons({ reasons, notes }: { reasons: Record<string, number>; notes: string[] }) {
  const c = useColors();
  return (
    <>
      <View style={styles.chips}>
        {Object.entries(reasons).map(([r, n]) => (
          <View key={r} style={[styles.chip, { backgroundColor: '#FDECEC' }]}>
            <Text style={[styles.chipText, { color: c.ink }]}>
              {pretty(r)} × {n}
            </Text>
          </View>
        ))}
      </View>
      {notes.map((n, i) => (
        <Text key={i} style={[styles.note, { color: c.inkMuted }]}>
          “{n}”
        </Text>
      ))}
    </>
  );
}

function Actions({ items }: { items: { label: string; onPress: () => void; danger?: boolean }[] }) {
  const c = useColors();
  return (
    <View style={styles.actions}>
      {items.map((a) => (
        <Pressable
          key={a.label}
          onPress={a.onPress}
          style={[styles.action, { borderColor: a.danger ? c.wrong : c.border }]}
          accessibilityRole="button"
        >
          <Text style={[styles.actionText, { color: a.danger ? c.wrong : c.ink }]}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const c = useColors();
  return (
    <TextInput
      style={[styles.input, { backgroundColor: c.field, color: c.ink }]}
      placeholder="Note (optional; a warning's note is shown to the person)"
      placeholderTextColor={c.inkFaint}
      value={value}
      onChangeText={onChange}
      maxLength={1000}
    />
  );
}

function SightingCard({ s, token, act }: { s: FlaggedSighting; token: string; act: Act }) {
  const c = useColors();
  const [note, setNote] = useState('');
  const run = (action: 'hide' | 'restore' | 'remove' | 'dismiss', done: string) =>
    act(() => moderateSighting(token, s.id, action, note.trim()), done);
  return (
    <View style={[styles.card, { borderColor: c.border }]}>
      <Pressable style={styles.head} onPress={() => router.push(`/sighting/${s.id}`)} accessibilityRole="button">
        {s.thumb_url ? (
          <Image source={{ uri: mediaUrl(s.thumb_url) }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, { backgroundColor: c.tint }]} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.ink }]}>{s.species || 'Unknown bird'}</Text>
          <Text style={[styles.sub, { color: c.inkMuted }]}>
            by {s.observer.display_name}
            {s.hidden ? ' · hidden' : ''} · open sighting ›
          </Text>
        </View>
      </Pressable>
      <Reasons reasons={s.reasons} notes={s.notes} />
      <NoteField value={note} onChange={setNote} />
      <Actions
        items={[
          s.hidden
            ? { label: 'Restore', onPress: () => run('restore', 'Sighting restored') }
            : { label: 'Hide', onPress: () => run('hide', 'Sighting hidden') },
          { label: 'Dismiss flags', onPress: () => run('dismiss', 'Flags dismissed') },
          {
            label: 'Remove',
            danger: true,
            onPress: () =>
              Alert.alert('Remove this sighting?', 'It is deleted with its photos and sounds. This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => run('remove', 'Sighting removed') },
              ]),
          },
        ]}
      />
    </View>
  );
}

function PersonCard({ p, token, act }: { p: ReportedPerson; token: string; act: Act }) {
  const c = useColors();
  const [note, setNote] = useState('');
  const run = (action: 'warn' | 'suspend' | 'ban' | 'unban' | 'dismiss', done: string, days = 0) =>
    act(() => moderatePerson(token, p.user.id, action, note.trim(), days), done);
  const suspended = p.suspended_until && new Date(p.suspended_until) > new Date();
  const status = p.banned
    ? 'Banned'
    : suspended
      ? `Suspended until ${new Date(p.suspended_until!).toLocaleDateString(undefined, { dateStyle: 'medium' })}`
      : '';
  return (
    <View style={[styles.card, { borderColor: c.border }]}>
      <View style={styles.head}>
        <View style={[styles.avatar, { backgroundColor: c.tint }]}>
          <Text style={[styles.avatarText, { color: c.tintIcon }]}>{p.user.display_name[0]?.toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.ink }]}>{p.user.display_name}</Text>
          <Text style={[styles.sub, { color: c.inkMuted }]}>
            {[status, p.warnings ? `${p.warnings} earlier warning${p.warnings > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') ||
              'No earlier action'}
          </Text>
        </View>
      </View>
      <Reasons reasons={p.reasons} notes={p.notes} />
      <NoteField value={note} onChange={setNote} />
      <Actions
        items={[
          { label: 'Warn', onPress: () => run('warn', 'Warning sent') },
          {
            label: 'Suspend',
            onPress: () =>
              Alert.alert(`Suspend ${p.user.display_name}?`, 'They are signed out and can’t sign in until it ends.', [
                { text: '1 day', onPress: () => run('suspend', 'Suspended for 1 day', 1) },
                { text: '7 days', onPress: () => run('suspend', 'Suspended for 7 days', 7) },
                { text: '30 days', onPress: () => run('suspend', 'Suspended for 30 days', 30) },
                { text: 'Cancel', style: 'cancel' },
              ]),
          },
          p.banned || suspended
            ? { label: 'Lift ban', onPress: () => run('unban', 'Ban lifted') }
            : {
                label: 'Ban',
                danger: true,
                onPress: () =>
                  Alert.alert(`Ban ${p.user.display_name}?`, 'They are signed out everywhere and can’t sign in again.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Ban', style: 'destructive', onPress: () => run('ban', 'Banned') },
                  ]),
              },
          { label: 'Dismiss', onPress: () => run('dismiss', 'Reports dismissed') },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: space.s, paddingHorizontal: space.screen, paddingBottom: space.l },
  tab: { flex: 1, height: 38, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontFamily: font.semibold, fontSize: 13 },
  content: { padding: space.screen, paddingTop: 0, gap: space.l, paddingBottom: space.xxl * 2 },
  muted: { fontFamily: font.regular, fontSize: 15, textAlign: 'center', marginTop: space.xl },
  card: { borderWidth: 1.5, borderRadius: radius.card, padding: space.l, gap: space.m },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  thumb: { width: 56, height: 56, borderRadius: radius.tile },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.bold, fontSize: 16 },
  title: { fontFamily: font.bold, fontSize: 16 },
  sub: { fontFamily: font.medium, fontSize: 13, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 5 },
  chipText: { fontFamily: font.semibold, fontSize: 12 },
  note: { fontFamily: font.italic, fontSize: 13 },
  input: { fontFamily: font.regular, fontSize: 14, borderRadius: radius.chip, paddingHorizontal: space.l, height: 44 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  action: { borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: space.l, height: 38, justifyContent: 'center' },
  actionText: { fontFamily: font.semibold, fontSize: 13 },
});
