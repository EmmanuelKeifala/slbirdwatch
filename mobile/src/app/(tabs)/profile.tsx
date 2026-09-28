import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Image, Linking, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormScroll } from '@/FormScroll';
import { deletePushToken, exportAccount, myDevices, type Device, type MyStats, type XP, exportLink, isAdmin, isModerator, isVerifier, mediaUrl, myStats, updateProfile, type ProfilePatch } from '@/api';
import { useAuth } from '@/auth';
import { getDeviceToken } from '@/pushToken';
import { BirdArt } from '@/BirdArt';
import { Pressable } from '@/Pressable';
import { useQuizStats } from '@/quizStore';
import { accuracy } from '@/stats';
import { font, radius, space, useColors, type Colors } from '@/theme';

type Icon = ComponentProps<typeof Feather>['name'];
const LEVEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert', '': '' } as const;
const ROLE = { member: '', trusted: 'Trusted member', verifier: 'Verifier', moderator: 'Moderator', admin: 'Admin' } as const;

export default function Profile() {
  const c = useColors();
  const s = styles(c);
  const { session, signOut, deleteAccount, setUser } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<MyStats | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const token = session?.token;
  const quiz = useQuizStats(token);

  useFocusEffect(
    useCallback(() => {
      if (token) myStats(token).then(setStats).catch(() => {});
      if (token) myDevices(token).then((r) => setDevices(r.items), () => {});
    }, [token]),
  );

  if (!session) {
    return (
      <SafeAreaView style={s.screen} edges={['top']}>
        <ScrollView contentContainerStyle={s.content}>
          <LinearGradient colors={[c.night[0], c.night[1], c.night[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
            <View style={s.heroArt}>
              <BirdArt id={7} size={150} />
            </View>
            <Text style={s.heroTitle}>Join the flock</Text>
            <Text style={s.heroText}>
              Browse freely without an account. Sign in to log what you see, help identify birds and keep your progress.
            </Text>
            <Pressable style={s.heroButton} onPress={() => router.push('/sign-in')} accessibilityRole="button">
              <Text style={s.heroButtonText}>Sign in or create account</Text>
            </Pressable>
          </LinearGradient>
          <Group>
            <Row icon="download-cloud" label="Offline bird guide" hint="Every Sierra Leone bird, for no-signal places" onPress={() => router.push('/offline')} />
            <Row icon="book" label="Community guidelines" onPress={() => router.push('/guidelines')} />
          </Group>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const user = session.user;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  // ACC-08 toggles save straight away.
  const toggle = (patch: ProfilePatch) => run(async () => setUser(await updateProfile(session.token, patch)));
  const download = () =>
    run(async () => {
      const data = await exportAccount(session.token);
      await Share.share({ title: 'My SL Birdwatch data', message: JSON.stringify(data, null, 2) });
    });
  const confirmDelete = () =>
    Alert.alert('Delete your account?', 'This removes your account and signs you out on every device. It cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => deleteAccount(password)) },
    ]);
  const confirmSignOut = () =>
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', onPress: () => run(signOut) },
    ]);

  const subtitle = [user.home_area, LEVEL[user.experience_level]].filter(Boolean).join(' · ');

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <FormScroll contentContainerStyle={s.content}>
        <LinearGradient colors={[c.night[0], c.night[1], c.night[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          <View style={s.heroTop}>
            {user.avatar_url ? (
              <Image source={{ uri: mediaUrl(user.avatar_url) }} style={s.avatar} />
            ) : (
              <View style={[s.avatar, s.avatarEmpty]}>
                <Text style={s.avatarInitial}>{user.display_name[0]?.toUpperCase()}</Text>
              </View>
            )}
            <Pressable style={s.edit} onPress={() => router.push('/profile-edit')} accessibilityRole="button">
              <Feather name="edit-2" size={14} color={c.ink} />
              <Text style={s.editText}>Edit profile</Text>
            </Pressable>
          </View>
          <Text style={s.name} accessibilityRole="header">
            {user.display_name}
          </Text>
          {!!ROLE[user.role] && (
            <View style={s.badge}>
              <Feather name="award" size={12} color="#FFFFFF" />
              <Text style={s.badgeText}>{ROLE[user.role]}</Text>
            </View>
          )}
          {!!subtitle && <Text style={s.heroText}>{subtitle}</Text>}
          {!!user.bio && (
            <Text style={[s.heroText, { marginTop: space.s }]} numberOfLines={4}>
              {user.bio}
            </Text>
          )}
        </LinearGradient>

        {stats && (
          <Text style={s.rowHint}>
            {stats.followers} follower{stats.followers === 1 ? '' : 's'} · following {stats.following}
          </Text>
        )}
        <View style={s.stats}>
          <Stat value={stats?.sightings} label="Sightings" tile={c.tiles[0]} onPress={() => router.push('/sightings')} />
          <Stat value={stats?.species} label="Species" tile={c.tiles[1]} onPress={() => router.push('/lifelist')} />
          <Stat value={stats?.identifications} label="IDs given" tile={c.tiles[4]} onPress={() => router.push('/identify')} />
          <Stat
            value={quiz.answered ? `${accuracy(quiz)}%` : '–'}
            label="Quiz score"
            tile={c.tiles[3]}
            onPress={() => router.push('/learn')}
          />
        </View>

        {stats && <XPCard xp={stats.xp} />}
        <Pressable style={s.rep} onPress={() => router.push('/achievements')} accessibilityRole="button">
          <View style={s.repHead}>
            <Feather name="award" size={18} color={c.tintIcon} />
            <Text style={[s.rowTitle, { flex: 1 }]}>Badges & streaks</Text>
            <Feather name="chevron-right" size={18} color={c.inkFaint} />
          </View>
        </Pressable>
        <Pressable style={s.rep} onPress={() => router.push('/groups')} accessibilityRole="button">
          <View style={s.repHead}>
            <Feather name="users" size={18} color={c.tintIcon} />
            <Text style={[s.rowTitle, { flex: 1 }]}>Groups & clubs</Text>
            <Feather name="chevron-right" size={18} color={c.inkFaint} />
          </View>
        </Pressable>
        <Pressable style={s.rep} onPress={() => router.push('/leaderboard')} accessibilityRole="button">
          <View style={s.repHead}>
            <Feather name="bar-chart" size={18} color={c.tintIcon} />
            <Text style={[s.rowTitle, { flex: 1 }]}>This week’s leaderboard</Text>
            <Feather name="chevron-right" size={18} color={c.inkFaint} />
          </View>
        </Pressable>
        {stats && <ReputationCard stats={stats} role={user.role} />}

        {user.warning && (
          <View style={s.warning} accessibilityRole="alert">
            <Feather name="alert-circle" size={18} color={c.ink} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.rowTitle}>A note from the moderators</Text>
              <Text style={s.rowHint}>
                {user.warning.note || 'Please follow the community guidelines.'} (
                {new Date(user.warning.at).toLocaleDateString(undefined, { dateStyle: 'medium' })})
              </Text>
            </View>
          </View>
        )}

        <Group>
          <Row icon="download-cloud" label="Offline bird guide" hint="Every Sierra Leone bird, for no-signal places" onPress={() => router.push('/offline')} />
        </Group>

        {isVerifier(user) && (
          <Group title="Your tools">
            <Row icon="check-circle" label="Review queue" hint="Confirm or correct IDs" onPress={() => router.push('/verify')} />
            {isModerator(user) && (
              <Row icon="shield" label="Moderation" hint="Flagged sightings and reported people" onPress={() => router.push('/moderate')} />
            )}
 {isAdmin(user) && (
              <Row icon="users" label="People and roles" hint="Make someone a verifier, moderator or admin" onPress={() => router.push('/people')} />
            )}
            {isAdmin(user) && (
              <Row icon="eye-off" label="Sensitive species" hint="Whose locations are blurred, and how far" onPress={() => router.push('/sensitive')} />
            )}
            {isAdmin(user) && (
              <Row icon="book-open" label="Lessons" hint="Write, order and hide the lessons on Learn" onPress={() => router.push('/admin-lessons')} />
            )}
            {isAdmin(user) && (
              <Row icon="flag" label="Weekly challenges" hint="Rewrite this week’s and upcoming challenges" onPress={() => router.push('/admin-challenges')} />
            )}
            {isAdmin(user) && (
              <Row icon="bar-chart-2" label="Analytics" hint="Uploads, learning, engagement, reach and quality" onPress={() => router.push('/admin-analytics')} />
            )}
            {isAdmin(user) && (
              <Row
                icon="download"
                label="Export data for researchers"
                hint="Verified sightings as Darwin Core CSV, blurred where needed"
                onPress={() =>
                  exportLink(session.token).then(
                    (r) => Linking.openURL(r.url),
                    (e) => Alert.alert('Couldn’t make the export', e instanceof Error ? e.message : String(e)),
                  )
                }
              />
            )}
          </Group>
        )}

        <Group title="Privacy">
          <ToggleRow
            icon="map-pin"
            label="Hide exact locations"
            hint="Others see your sightings within about 11 km. Verifiers still see the exact spot."
            value={user.hide_locations}
            disabled={busy}
            onChange={(v) => toggle({ hide_locations: v })}
          />
          <ToggleRow
            icon="lock"
            label="Private profile"
            hint="Others see only your name and photo."
            value={user.private_profile}
            disabled={busy}
            onChange={(v) => toggle({ private_profile: v })}
          />
          <ToggleRow
            icon="bar-chart"
            label="Hide me from leaderboards"
            hint="Your XP still counts for your level and badges."
            value={user.hide_from_leaderboards}
            disabled={busy}
            onChange={(v) => toggle({ hide_from_leaderboards: v })}
          />
        </Group>

        <Group title="Notifications">
          <Row icon="star" label="Rare bird alerts" hint="When a rare bird is verified near you" onPress={() => router.push('/alerts')} />
          <ToggleRow
            icon="message-circle"
            label="IDs on my sightings"
            hint="When someone suggests or agrees with an ID."
            value={user.notify_ids}
            disabled={busy}
            onChange={(v) => toggle({ notify_ids: v })}
          />
          <ToggleRow
            icon="check-circle"
            label="Community ID and verified"
            hint="When a sighting of yours is agreed on or confirmed."
            value={user.notify_status}
            disabled={busy}
            onChange={(v) => toggle({ notify_status: v })}
          />
          <ToggleRow
            icon="message-square"
            label="Comments and replies"
            hint="When someone comments on your sighting or replies to you."
            value={user.notify_comments}
            disabled={busy}
            onChange={(v) => toggle({ notify_comments: v })}
          />
          <ToggleRow
            icon="flag"
            label="Challenges and streaks"
            hint="New weekly challenges on Monday, and a nudge before a quiz or outing streak runs out."
            value={user.notify_reminders}
            disabled={busy}
            onChange={(v) => toggle({ notify_reminders: v })}
          />
        </Group>

        {devices.length > 0 && (
          <Group title="Devices getting notifications">
            {devices.map((d) => {
              const here = d.token === getDeviceToken();
              return (
                <View key={d.token} style={s.row}>
                  <View style={s.rowIcon}>
                    <Feather name="smartphone" size={18} color={c.tintIcon} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>
                      {d.name || (d.platform === 'ios' ? 'iPhone' : 'Android phone')}
                      {here ? ' · this phone' : ''}
                    </Text>
                    <Text style={s.rowHint}>
                      Added {new Date(d.added_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                    </Text>
                  </View>
                  {!here && (
                    <Pressable
                      onPress={() =>
                        deletePushToken(session.token, d.token).then(() => setDevices(devices.filter((x) => x.token !== d.token)))
                      }
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Stop notifications on ${d.name || 'this device'}`}
                    >
                      <Feather name="x" size={18} color={c.inkMuted} />
                    </Pressable>
                  )}
                </View>
              );
            })}
          </Group>
        )}

        <Group title="Account">
          <Row icon="book" label="Community guidelines" onPress={() => router.push('/guidelines')} />
          <Row icon="slash" label="Blocked people" onPress={() => router.push('/blocked')} />
          <Row icon="download" label="Download my data" onPress={download} />
          <Row icon="log-out" label="Sign out" onPress={confirmSignOut} />
        </Group>

        {!deleting ? (
          <Pressable style={s.link} onPress={() => setDeleting(true)} accessibilityRole="button">
            <Text style={[s.linkText, { color: c.wrong }]}>Delete account</Text>
          </Pressable>
        ) : (
          <View style={s.dangerZone}>
            <Text style={s.rowHint}>
              {user.has_password ? 'Enter your password to delete your account.' : 'Type DELETE to delete your account.'}
            </Text>
            <TextInput
              style={s.input}
              placeholder={user.has_password ? 'Password' : 'DELETE'}
              placeholderTextColor={c.inkMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={user.has_password}
              autoCapitalize={user.has_password ? 'none' : 'characters'}
              autoComplete={user.has_password ? 'current-password' : 'off'}
              accessibilityLabel="Password"
            />
            <Pressable
              style={[s.danger, (!password || busy) && { opacity: 0.5 }]}
              onPress={confirmDelete}
              disabled={!password || busy}
              accessibilityRole="button"
            >
              <Text style={s.dangerText}>Delete my account</Text>
            </Pressable>
            <Pressable
              style={s.link}
              onPress={() => {
                setDeleting(false);
                setPassword('');
              }}
              accessibilityRole="button"
            >
              <Text style={[s.linkText, { color: c.inkMuted }]}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {busy && <ActivityIndicator color={c.accent} />}
        {error && (
          <Text style={s.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
        <Text style={s.email}>Signed in as {user.email}</Text>
      </FormScroll>
    </SafeAreaView>
  );
}

/** GAM-02/08: level, progress to the next one, and how XP is earned (with today's caps). */
function XPCard({ xp }: { xp: XP }) {
  const c = useColors();
  const s = styles(c);
  const [open, setOpen] = useState(false);
  const pct = xp.next_at ? (100 * (xp.xp - xp.level_at)) / (xp.next_at - xp.level_at) : 100;
  return (
    <Pressable style={s.rep} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <View style={s.repHead}>
        <View style={[s.levelBadge, { backgroundColor: c.primary }]}>
          <Text style={[s.levelNum, { color: c.onPrimary }]}>{xp.level}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.rowTitle}>{xp.level_name}</Text>
          <Text style={s.rowHint}>
            {xp.xp} XP{xp.next_at ? ` · ${xp.next_at - xp.xp} to the next level` : ' · top level'}
          </Text>
        </View>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.inkFaint} />
      </View>
      <View style={[s.bar, { backgroundColor: c.field }]}>
        <View style={[s.barFill, { backgroundColor: c.accent, width: `${Math.min(100, pct)}%` }]} />
      </View>
      {open && (
        <View style={{ gap: 6, marginTop: space.s }}>
          {xp.rules.map((r) => (
            <View key={r.key} style={s.xpRule}>
              <Text style={[s.rowHint, { flex: 1 }]}>
                {r.label}
                {r.per_day ? ` · today ${Math.min(xp.today[r.key] ?? 0, r.per_day)}/${r.per_day}` : ''}
              </Text>
              <Text style={s.xpPts}>+{r.points}</Text>
            </View>
          ))}
          <Text style={s.rowHint}>Sightings earn XP once verified. Daily caps keep it fair.</Text>
        </View>
      )}
    </Pressable>
  );
}

/** VER-06: IDs confirmed by verifiers, accuracy, and (for members) how far to Trusted. */
function ReputationCard({ stats, role }: { stats: MyStats; role: string }) {
  const c = useColors();
  const s = styles(c);
  const { confirmed, wrong, accuracy } = stats.reputation;
  const member = role === 'member';
  const left = Math.max(0, stats.trusted_at - confirmed);
  const lowAccuracy = confirmed + wrong > 0 && accuracy < stats.trusted_accuracy;
  return (
    <View style={s.rep}>
      <View style={s.repHead}>
        <Feather name="award" size={18} color={c.tintIcon} />
        <Text style={s.rowTitle}>Reputation</Text>
      </View>
      <Text style={s.rowHint}>
        {confirmed + wrong === 0
          ? 'Suggest IDs on other people’s sightings. When a verifier agrees, it counts here.'
          : `${confirmed} confirmed ID${confirmed === 1 ? '' : 's'} · ${accuracy}% right`}
      </Text>
      {member && (
        <>
          <View style={[s.bar, { backgroundColor: c.field }]}>
            <View style={[s.barFill, { backgroundColor: c.accent, width: `${Math.min(100, (100 * confirmed) / stats.trusted_at)}%` }]} />
          </View>
          <Text style={s.rowHint}>
            {left > 0
              ? `${left} more confirmed ID${left === 1 ? '' : 's'} to become a Trusted member`
              : lowAccuracy
                ? `Trusted members get at least ${stats.trusted_accuracy}% right. Keep going!`
                : 'You’ll become Trusted with your next confirmed ID.'}
          </Text>
        </>
      )}
    </View>
  );
}

function Stat({ value, label, tile, onPress }: { value: number | string | undefined; label: string; tile: string; onPress: () => void }) {
  const c = useColors();
  const s = styles(c);
  return (
    <Pressable
      style={[s.stat, { backgroundColor: tile }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value ?? 0} ${label}`}
    >
      <Text style={s.statValue}>{value ?? '–'}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </Pressable>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  const c = useColors();
  const s = styles(c);
  return (
    <View style={{ gap: space.s }}>
      {!!title && <Text style={s.groupTitle}>{title}</Text>}
      <View style={s.group}>{children}</View>
    </View>
  );
}

function Row({ icon, label, hint, onPress }: { icon: Icon; label: string; hint?: string; onPress: () => void }) {
  const c = useColors();
  const s = styles(c);
  return (
    <Pressable style={s.row} onPress={onPress} accessibilityRole="button">
      <View style={s.rowIcon}>
        <Feather name={icon} size={18} color={c.tintIcon} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{label}</Text>
        {!!hint && <Text style={s.rowHint}>{hint}</Text>}
      </View>
      <Feather name="chevron-right" size={18} color={c.inkFaint} />
    </Pressable>
  );
}

function ToggleRow(p: { icon: Icon; label: string; hint: string; value: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  const c = useColors();
  const s = styles(c);
  return (
    <View style={s.row}>
      <View style={s.rowIcon}>
        <Feather name={p.icon} size={18} color={c.tintIcon} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{p.label}</Text>
        <Text style={s.rowHint}>{p.hint}</Text>
      </View>
      <Switch
        value={p.value}
        onValueChange={p.onChange}
        disabled={p.disabled}
        trackColor={{ true: c.accent, false: c.border }}
        accessibilityLabel={p.label}
      />
    </View>
  );
}

const styles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: space.screen, gap: space.xl, paddingBottom: space.xxl * 2 },
    hero: { borderRadius: radius.card, padding: space.xl, gap: space.xs, overflow: 'hidden' },
    heroArt: { position: 'absolute', right: -20, top: -10, opacity: 0.9 },
    heroTitle: { fontFamily: font.display, fontSize: 34, lineHeight: 38, color: '#FFFFFF', marginTop: 90 },
    heroText: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: '#E3E0FF' },
    heroButton: {
      backgroundColor: '#FFFFFF',
      borderRadius: radius.pill,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.l,
    },
    heroButtonText: { fontFamily: font.semibold, fontSize: 15, color: c.ink },
    heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: space.m },
    avatar: { width: 84, height: 84, borderRadius: radius.pill, borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
    avatarEmpty: { backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' },
    avatarInitial: { fontFamily: font.display, fontSize: 34, color: c.tintIcon },
    edit: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: '#FFFFFF',
      borderRadius: radius.pill,
      paddingHorizontal: space.m,
      height: 36,
    },
    editText: { fontFamily: font.semibold, fontSize: 13, color: c.ink },
    name: { fontFamily: font.display, fontSize: 32, lineHeight: 36, color: '#FFFFFF' },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 4,
      backgroundColor: 'rgba(255,255,255,0.18)',
      borderRadius: radius.pill,
      paddingHorizontal: space.s,
      paddingVertical: 3,
      marginVertical: 2,
    },
    badgeText: { fontFamily: font.semibold, fontSize: 12, color: '#FFFFFF' },
    stats: { flexDirection: 'row', gap: space.s },
    stat: { flex: 1, borderRadius: radius.tile, paddingVertical: space.l, alignItems: 'center', gap: 2 },
    statValue: { fontFamily: font.display, fontSize: 24, color: c.ink },
    statLabel: { fontFamily: font.semibold, fontSize: 11, color: c.inkMuted },
    rep: { borderColor: c.border, borderWidth: 1.5, borderRadius: radius.card, padding: space.l, gap: space.s },
    repHead: { flexDirection: 'row', alignItems: 'center', gap: space.s },
    levelBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    levelNum: { fontFamily: font.display, fontSize: 18 },
    xpRule: { flexDirection: 'row', alignItems: 'center', gap: space.s },
    xpPts: { fontFamily: font.bold, fontSize: 13, color: c.accentDeep },
    bar: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
    barFill: { height: 8, borderRadius: radius.pill },
    warning: { flexDirection: 'row', gap: space.m, backgroundColor: '#FFF6DD', borderRadius: radius.tile, padding: space.l },
    groupTitle: { fontFamily: font.bold, fontSize: 13, color: c.inkMuted, marginLeft: space.xs },
    group: { borderColor: c.border, borderWidth: 1.5, borderRadius: radius.card, paddingHorizontal: space.l, paddingVertical: space.xs },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, minHeight: 56 },
    rowIcon: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' },
    rowTitle: { fontFamily: font.semibold, fontSize: 15, color: c.ink },
    rowHint: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: c.inkMuted, marginTop: 2 },
    link: { alignItems: 'center', paddingVertical: space.s },
    linkText: { fontFamily: font.semibold, fontSize: 15 },
    dangerZone: { gap: space.m, padding: space.l, borderRadius: radius.card, borderColor: c.wrong, borderWidth: 1 },
    input: {
      fontFamily: font.regular,
      fontSize: 15,
      color: c.ink,
      backgroundColor: c.field,
      borderRadius: radius.pill,
      paddingHorizontal: space.xl,
      height: 52,
    },
    danger: { backgroundColor: c.wrong, borderRadius: radius.pill, height: 52, alignItems: 'center', justifyContent: 'center' },
    dangerText: { fontFamily: font.semibold, fontSize: 15, color: '#FFFFFF' },
    error: { fontFamily: font.medium, fontSize: 14, color: c.wrong, textAlign: 'center' },
    email: { fontFamily: font.medium, fontSize: 12, color: c.inkFaint, textAlign: 'center' },
  });
