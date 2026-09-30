import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deletePack, downloadPack, packInfo, type PackInfo } from '@/state/offlinePack';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

const mb = (b: number) => `${Math.max(1, Math.round(b / 1e6))} MB`;

/** LIB-11: download Sierra Leone's birds for places with no signal. */
export default function Offline() {
  const c = useColors();
  const [info, setInfo] = useState<PackInfo | null>(packInfo);
  const [calls, setCalls] = useState(info?.calls ?? false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const download = async () => {
    setProgress({ done: 0, total: 0 });
    try {
      setInfo(await downloadPack(calls, (done, total) => setProgress({ done, total })));
    } catch (e) {
      Alert.alert('Download stopped', `${e instanceof Error ? e.message : String(e)}\nYour previous guide, if any, is still there.`);
    } finally {
      setProgress(null);
    }
  };
  const remove = () =>
    Alert.alert('Remove the offline guide?', 'You can download it again any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          deletePack();
          setInfo(null);
        },
      },
    ]);
  const pct = progress && progress.total ? Math.round((100 * progress.done) / progress.total) : 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Offline bird guide" back />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.hero, { backgroundColor: c.tint }]}>
          <Feather name="download-cloud" size={28} color={c.tintIcon} />
          <Text style={[styles.lead, { color: c.ink }]}>
            Every Sierra Leone bird on your phone, for the forest and the coast where there’s no signal: names in local languages,
            descriptions, when to see them, a photo of each and, if you like, a call.
          </Text>
        </View>

        {info && (
          <View style={[styles.card, { borderColor: c.correct }]}>
            <Text style={[styles.title, { color: c.ink }]}>
              <Feather name="check-circle" size={16} color={c.correct} /> On this phone
            </Text>
            <Text style={[styles.body, { color: c.inkMuted }]}>
              {info.species} birds{info.calls ? ' with calls' : ''} · {mb(info.bytes)} · saved{' '}
              {new Date(info.savedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </Text>
            <Text style={[styles.body, { color: c.inkMuted }]}>
              When there’s no signal, the library and bird pages use it. Download again now and then for new photos and text.
            </Text>
          </View>
        )}

        <View style={[styles.card, { borderColor: c.border }]}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.ink }]}>Include calls</Text>
              <Text style={[styles.body, { color: c.inkMuted }]}>About 90 MB more. Without: about 25 MB.</Text>
            </View>
            <Switch value={calls} onValueChange={setCalls} disabled={!!progress} trackColor={{ true: c.accent, false: c.border }} />
          </View>
          <Text style={[styles.body, { color: c.inkFaint }]}>Use Wi-Fi if you can. Photo and sound galleries stay online.</Text>
        </View>

        {progress ? (
          <View style={{ gap: space.s }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
            <View style={[styles.track, { backgroundColor: c.field }]}>
              <View style={[styles.fill, { backgroundColor: c.accent, width: `${pct}%` }]} />
            </View>
            <Text style={[styles.body, { color: c.inkMuted }]}>
              {progress.total ? `Downloading… ${progress.done} of ${progress.total} files` : 'Getting the list of birds…'}
            </Text>
          </View>
        ) : (
          <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={download} accessibilityRole="button">
            <Text style={[styles.primaryText, { color: c.onPrimary }]}>{info ? 'Update the guide' : 'Download the guide'}</Text>
          </Pressable>
        )}
        {info && !progress && (
          <Pressable onPress={remove} accessibilityRole="button">
            <Text style={[styles.remove, { color: c.wrong }]}>Remove from this phone</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.l, paddingBottom: space.xxl * 2 },
  hero: { borderRadius: radius.card, padding: space.l, gap: space.m },
  lead: { fontFamily: font.medium, fontSize: 15, lineHeight: 22 },
  card: { borderWidth: 1.5, borderRadius: radius.card, padding: space.l, gap: space.s },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  title: { fontFamily: font.bold, fontSize: 15 },
  body: { fontFamily: font.medium, fontSize: 13, lineHeight: 19 },
  track: { height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 10, borderRadius: radius.pill },
  primary: { height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: font.semibold, fontSize: 15 },
  remove: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center' },
});
