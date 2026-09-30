import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { adminAnalytics, type Analytics, type WeekCount } from '@/api';
import { useAuth } from '@/state/auth';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

const hours = (h: number | null) => (h === null ? '–' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);
const pctOrDash = (v: number | null) => (v === null ? '–' : `${v}%`);

/** ADM-06 (admins): the KPIs from BRD §2.2, grouped as in the BRD. Pull down to refresh. */
export default function AdminAnalytics() {
  const c = useColors();
  const token = useAuth().session!.token;
  const [a, setA] = useState<Analytics | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(() => {
    setRefreshing(true);
    adminAnalytics(token)
      .then((r) => {
        setA(r);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setRefreshing(false));
  }, [token]);
  useFocusEffect(load);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Analytics" back />
      {!a ? (
        error ? (
          <Text style={[styles.note, { color: c.wrong, padding: space.screen }]}>Couldn’t load the numbers.</Text>
        ) : (
          <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
        )
      ) : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}>
          <Section title="Library">
            <Tile value={a.library.species} label="Sierra Leone species" />
            <Tile value={`${a.library.photos3_pct}%`} label="with 3+ trusted photos" />
            <Tile value={`${a.library.call_pct}%`} label="with a trusted call" />
            <Tile value={a.library.lessons} label="lessons live" />
            <Tile value={a.library.expert_tips} label="expert ID tips" />
            <Tile value={a.library.reference} label="reference photos" />
          </Section>

          <Section title="Contribution">
            <WeekBars title="Uploads per week" weeks={a.contribution.uploads_per_week} unit="upload" />
            <Tile value={`${a.contribution.reached_pct}%`} label="of uploads reach a community ID (7–97 days old)" />
            <Tile value={a.contribution.verified} label="verified sightings, all time" />
          </Section>

          <Section title="Learning">
            <WeekBars title="Quizzes per week" weeks={a.learning.quizzes_per_week} unit="quiz" plural="quizzes" />
            <Tile
              value={a.learning.improvement_pts === null ? '–' : `${a.learning.improvement_pts > 0 ? '+' : ''}${a.learning.improvement_pts} pts`}
              label={`median accuracy change after 4 weeks (${a.learning.improvement_users} people)`}
            />
          </Section>

          <Section title="Engagement">
            <Tile value={`${a.engagement.dau_mau_pct}%`} label={`DAU/MAU (${a.engagement.dau} today, ${a.engagement.mau} this month)`} />
            <Tile value={pctOrDash(a.engagement.d7_pct)} label="D7 retention" />
            <Tile value={pctOrDash(a.engagement.d30_pct)} label="D30 retention" />
            <Tile
              value={`${a.engagement.challenge_active}/${a.engagement.challenge_of}`}
              label={`active people tried last week’s challenges; ${a.engagement.challenge_done} completed`}
            />
          </Section>

          <Section title="Reach">
            <Tile value={a.reach.anon_7_days} label={`signed-out bird page views, 7 days (${a.reach.anon_today} today)`} />
            <Tile value={a.reach.accounts} label={`accounts (${a.reach.new_week} new this week)`} />
            {Object.entries(a.reach.devices).map(([p, n]) => (
              <Tile key={p} value={n} label={`${p === 'ios' ? 'iPhones' : p === 'android' ? 'Android phones' : 'other phones'} with notifications`} />
            ))}
          </Section>

          <Section title="Quality">
            <Tile value={hours(a.quality.first_id_hours)} label="median time to a first ID suggestion (90 days)" />
            <Tile value={hours(a.quality.resolution_hours)} label="median time to deal with a report (90 days)" />
            <Tile value={a.quality.open_reports} label="reports open now" />
            <Tile value={a.quality.awaiting_id} label="sightings waiting for an ID" />
          </Section>
          <Text style={[styles.note, { color: c.inkFaint }]}>
            Retention counts people who come back on days 7–13 (D7) or 30–36 (D30) after signing up. Phone counts are phones that
            allowed notifications.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: space.s }}>
      <Text style={[styles.h2, { color: c.ink }]}>{title}</Text>
      <View style={styles.tiles}>{children}</View>
    </View>
  );
}

function Tile({ value, label }: { value: number | string; label: string }) {
  const c = useColors();
  return (
    <View style={[styles.tile, { borderColor: c.border }]} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={[styles.value, { color: c.ink }]}>{value}</Text>
      <Text style={[styles.label, { color: c.inkMuted }]}>{label}</Text>
    </View>
  );
}

/** One series of weekly counts, oldest first: thin bars from a shared baseline; tap one for its week and count. */
function WeekBars({ title, weeks, unit, plural }: { title: string; weeks: WeekCount[]; unit: string; plural?: string }) {
  const c = useColors();
  const [picked, setPicked] = useState(weeks.length - 1);
  const top = Math.max(1, ...weeks.map((w) => w.count));
  const w = weeks[picked];
  const name = (n: number) => `${n} ${n === 1 ? unit : (plural ?? `${unit}s`)}`;
  const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return (
    <View
      style={[styles.chart, { borderColor: c.border }]}
      accessible
      accessibilityLabel={`${title}: ${weeks.map((x) => `week of ${when(x.week)} ${x.count}`).join(', ')}`}
    >
      <Text style={[styles.chartTitle, { color: c.ink }]}>{title}</Text>
      <Text style={[styles.label, { color: c.inkMuted }]}>
        {picked === weeks.length - 1 ? 'This week' : `Week of ${when(w.week)}`} · {name(w.count)}
      </Text>
      <View style={[styles.plot, { borderBottomColor: c.border }]}>
        {weeks.map((x, i) => (
          <Pressable key={x.week} style={styles.slot} onPress={() => setPicked(i)} hitSlop={4}>
            <View style={[styles.bar, { height: x.count ? Math.max(3, (x.count / top) * 80) : 0, backgroundColor: i === picked ? c.accentDeep : c.accent }]} />
          </Pressable>
        ))}
      </View>
      <View style={styles.axis}>
        <Text style={[styles.tick, { color: c.inkFaint }]}>{when(weeks[0].week)}</Text>
        <Text style={[styles.tick, { color: c.inkFaint }]}>this week</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.xl, paddingBottom: space.xxl * 2 },
  h2: { fontFamily: font.display, fontSize: 22 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  tile: { width: '48%', flexGrow: 1, borderWidth: 1, borderRadius: radius.tile, padding: space.m, gap: 2 },
  value: { fontFamily: font.display, fontSize: 26 },
  label: { fontFamily: font.medium, fontSize: 12, lineHeight: 16 },
  chart: { width: '100%', borderWidth: 1, borderRadius: radius.tile, padding: space.m, gap: 4 },
  chartTitle: { fontFamily: font.bold, fontSize: 14 },
  plot: { height: 88, flexDirection: 'row', alignItems: 'flex-end', gap: 6, borderBottomWidth: 1, marginTop: space.s },
  slot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  tick: { fontFamily: font.medium, fontSize: 11 },
  note: { fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
});
