import { Feather } from '@expo/vector-icons';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/components/Pressable';

import { acceptGuidelines } from '@/api';
import { useAuth } from '@/state/auth';
import { font, radius, space, useColors } from '@/theme';

const RULES: { icon: ComponentProps<typeof Feather>['name']; title: string; body: string }[] = [
  {
    icon: 'heart',
    title: 'The bird comes first',
    body: 'Keep your distance, especially at nests and roosts. If a bird changes its behaviour because of you, you are too close.',
  },
  {
    icon: 'volume-x',
    title: 'Go easy on playback',
    body: 'Don’t play calls to lure birds, and never during breeding season or for rare or threatened species.',
  },
  {
    icon: 'eye-off',
    title: 'Protect sensitive sites',
    body: 'Some species are targeted by trappers. Their locations are hidden automatically; don’t share them elsewhere either.',
  },
  {
    icon: 'check-circle',
    title: 'Be honest about IDs',
    body: 'Only upload your own photos and recordings, of birds you saw. “I don’t know” is always a good answer.',
  },
  {
    icon: 'users',
    title: 'Be kind',
    body: 'Everyone is learning. Suggest IDs with a reason, and respect private land and local rules.',
  },
];

/** COM-06 community guidelines and birding ethics. With `onAccepted`, shows an "I agree" button. */
export function Guidelines({ onAccepted }: { onAccepted?: () => void }) {
  const c = useColors();
  const { session, setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await setUser(await acceptGuidelines(session!.token));
      onAccepted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: c.ink }]} accessibilityRole="header">
        Before your first sighting
      </Text>
      <Text style={[styles.lead, { color: c.inkMuted }]}>A few promises that keep birds safe and the community friendly.</Text>
      {RULES.map((r) => (
        <View key={r.title} style={styles.rule}>
          <View style={[styles.icon, { backgroundColor: c.tint }]}>
            <Feather name={r.icon} size={18} color={c.tintIcon} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.ruleTitle, { color: c.ink }]}>{r.title}</Text>
            <Text style={[styles.ruleBody, { color: c.inkMuted }]}>{r.body}</Text>
          </View>
        </View>
      ))}
      {error && <Text style={[styles.ruleBody, { color: c.wrong, textAlign: 'center' }]}>{error}</Text>}
      {onAccepted && session && !session.user.guidelines_accepted && (
        <Pressable
          style={[styles.primary, { backgroundColor: c.primary }, busy && { opacity: 0.6 }]}
          onPress={accept}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color={c.onPrimary} /> : <Text style={[styles.primaryText, { color: c.onPrimary }]}>I agree</Text>}
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, paddingTop: space.xxl, gap: space.l, paddingBottom: space.xxl * 2 },
  title: { fontFamily: font.display, fontSize: 34, lineHeight: 38 },
  lead: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  rule: { flexDirection: 'row', gap: space.m },
  icon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  ruleTitle: { fontFamily: font.bold, fontSize: 16 },
  ruleBody: { fontFamily: font.regular, fontSize: 14, lineHeight: 21, marginTop: 2 },
  primary: { height: 56, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginTop: space.m },
  primaryText: { fontFamily: font.semibold, fontSize: 16 },
});
