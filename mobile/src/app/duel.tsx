import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createDuel, getDuel, mediaUrl, myDuels, scoreDuel, type Duel } from '@/api';
import { useAuth } from '@/state/auth';
import { FormScroll } from '@/components/FormScroll';
import { close, signInFirst } from '@/lib/nav';
import { Pressable } from '@/components/Pressable';
import { SoundPlayer } from '@/components/SoundPlayer';
import { GameBar } from '@/components/GameBar';
import { font, radius, space, tileFor, useColors } from '@/theme';
import { answerFeel } from '@/lib/haptics';

/** QZ-11 head-to-head: make a challenge or enter a friend's code, play the same 10 questions, compare. */
export default function DuelScreen() {
  const c = useColors();
  const { session } = useAuth();
  const token = session?.token;
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(params.code ?? '');
  const [duel, setDuel] = useState<Duel | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof myDuels>>['items']>([]);
  const [i, setI] = useState(0);
  const [picks, setPicks] = useState<number[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const started = useRef(0);

  const take = async (fn: () => Promise<Duel>) => {
    setBusy(true);
    try {
      const d = await fn();
      setDuel(d);
      setI(0);
      setPicks([]);
      setPicked(null);
      started.current = 0; // the clock starts at the first answer
    } catch (e) {
      Alert.alert('That didn’t work', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  function open(c0: string) {
    take(() => getDuel(token!, c0.trim().toUpperCase()));
  }
  useEffect(() => {
    if (!token) return;
    myDuels(token).then(
      (r) => setRecent(r.items),
      () => {},
    );
    if (params.code)
      getDuel(token, params.code.toUpperCase()).then(
        (d) => {
          setDuel(d);
          started.current = 0;
        },
        () => {},
      );
  }, [token, params.code]);

  if (!token) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}>
        <Text style={[styles.body, { color: c.inkMuted }]}>Sign in to challenge friends.</Text>
        <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={() => signInFirst('Sign in to challenge friends.')}>
          <Text style={[styles.primaryText, { color: c.onPrimary }]}>Sign in</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const share = (d: Duel) =>
    Share.share({
      message: `I scored ${d.scores.find((s) => s.me)?.right ?? '?'}/${d.questions.length} on this bird quiz. Can you beat me? Open SL Birdwatch → Games → Challenge a friend, and enter ${d.code}`,
    }).catch(() => {});

  // landing: make one or enter a code
  if (!duel) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <GameBar onClose={close} closeLabel="Close" label="CHALLENGE A FRIEND" />
        <FormScroll contentContainerStyle={styles.content}>
          <Text style={[styles.title, { color: c.ink }]}>Same 10 birds, who knows them best?</Text>
          <Text style={[styles.body, { color: c.inkMuted, textAlign: 'left' }]}>
            Play a quiz, then send the code. Friends play exactly the same questions. Most right wins; the faster breaks a tie.
          </Text>
          <View style={styles.row}>
            {(['picture', 'sound'] as const).map((k) => (
              <Pressable
                key={k}
                disabled={busy}
                style={[styles.make, { backgroundColor: k === 'picture' ? c.tiles[0] : c.tiles[1] }]}
                onPress={() => take(() => createDuel(token, k))}
                accessibilityRole="button"
              >
                <Feather name={k === 'picture' ? 'image' : 'music'} size={26} color={c.accentDeep} />
                <Text style={[styles.makeText, { color: c.ink }]}>{k === 'picture' ? 'Picture challenge' : 'Sound challenge'}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.h2, { color: c.ink }]}>Have a code?</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.code, { color: c.ink, backgroundColor: c.field }]}
              value={code}
              onChangeText={(t) =>
                setCode(
                  t
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, 6),
                )
              }
              placeholder="CODE"
              placeholderTextColor={c.inkFaint}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Pressable
              style={[styles.go, { backgroundColor: c.primary }, (busy || code.length !== 6) && { opacity: 0.4 }]}
              disabled={busy || code.length !== 6}
              onPress={() => open(code)}
              accessibilityRole="button"
            >
              <Text style={[styles.primaryText, { color: c.onPrimary }]}>Play</Text>
            </Pressable>
          </View>
          {busy && <ActivityIndicator color={c.accent} />}
          {recent.length > 0 && (
            <>
              <Text style={[styles.h2, { color: c.ink }]}>Your challenges</Text>
              {recent.map((r) => (
                <Pressable
                  key={r.code}
                  style={[styles.recent, { borderColor: c.border }]}
                  onPress={() => open(r.code)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.recentCode, { color: c.ink }]}>{r.code}</Text>
                  <Text style={[styles.meta, { color: c.inkMuted, flex: 1 }]}>
                    {r.kind === 'sound' ? 'Sounds' : 'Pictures'} · by {r.creator} · {r.players} played
                    {r.mine !== null ? ` · you ${r.mine}` : ''}
                  </Text>
                  <Feather name="chevron-right" size={18} color={c.inkFaint} />
                </Pressable>
              ))}
            </>
          )}
        </FormScroll>
      </SafeAreaView>
    );
  }

  // results
  if (duel.played) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <GameBar onClose={() => setDuel(null)} closeLabel="Back" back label={`CHALLENGE ${duel.code}`} />
        <FormScroll contentContainerStyle={styles.content}>
          {duel.scores.map((s, k) => (
            <View
              key={s.user.id}
              style={[styles.score, { borderColor: s.me ? c.accent : c.border, backgroundColor: s.me ? c.tint : c.bg }]}
            >
              <Text style={[styles.place, { color: k === 0 ? '#F4B400' : c.inkMuted }]}>{k === 0 ? '★' : k + 1}</Text>
              <Text style={[styles.name, { color: c.ink }]} numberOfLines={1}>
                {s.user.display_name}
                {s.me ? ' (you)' : ''}
              </Text>
              <Text style={[styles.big, { color: c.ink }]}>
                {s.right}/{s.of}
              </Text>
              <Text style={[styles.meta, { color: c.inkMuted }]}>{Math.round(s.time_s)}s</Text>
            </View>
          ))}
          {duel.scores.length === 1 && (
            <Text style={[styles.body, { color: c.inkMuted }]}>Nobody else yet. Send the code and see who knows their birds.</Text>
          )}
          <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={() => share(duel)} accessibilityRole="button">
            <Feather name="share-2" size={18} color={c.onPrimary} />
            <Text style={[styles.primaryText, { color: c.onPrimary }]}>Send the code {duel.code}</Text>
          </Pressable>
          <Text style={[styles.meta, { color: c.inkFaint, textAlign: 'center' }]}>
            Open until {new Date(duel.expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </Text>
        </FormScroll>
      </SafeAreaView>
    );
  }

  // playing
  const q = duel.questions[i];
  const answered = picked !== null;
  // timing from the taps' own timestamps: first answer to the final tap
  const choose = (id: number, at: number) => {
    if (answered) return;
    if (!started.current) started.current = at;
    setPicked(id);
    answerFeel(id === q.answer.id);
    setPicks([...picks, id]);
  };
  const next = (at: number) => {
    if (i + 1 < duel.questions.length) {
      setI(i + 1);
      setPicked(null);
      return;
    }
    const ms = Math.max(0, Math.round(at - started.current));
    take(() => scoreDuel(token, duel.code, picks, ms));
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <GameBar onClose={close} label={`vs ${duel.creator.display_name} · ${i + 1}/${duel.questions.length}`} />
      <FormScroll contentContainerStyle={styles.content}>
        {q.sound ? (
          <SoundPlayer key={q.media_ref} sound={{ url: q.sound.url, spectrogram_url: q.sound.spectrogram_url, duration_s: 0 }} />
        ) : (
          q.image && (
            <View style={[styles.photoWrap, { backgroundColor: tileFor(c, q.answer.id) }]}>
              <Image source={{ uri: mediaUrl(q.image.url) }} style={styles.photo} contentFit="cover" />
            </View>
          )
        )}
        {q.options.map((o) => {
          const isAnswer = o.id === q.answer.id;
          const bg = !answered ? c.bg : isAnswer ? '#E3F5EC' : o.id === picked ? '#FDE8E8' : c.bg;
          const border = !answered ? c.border : isAnswer ? c.correct : o.id === picked ? c.wrong : c.border;
          return (
            <Pressable
              key={o.id}
              style={[styles.option, { backgroundColor: bg, borderColor: border }]}
              onPress={(e) => choose(o.id, e.nativeEvent.timestamp)}
              disabled={answered}
              accessibilityRole="button"
            >
              <Text style={[styles.optionText, { color: c.ink }]}>{o.english_name}</Text>
            </Pressable>
          );
        })}
        {answered && (
          <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={(e) => next(e.nativeEvent.timestamp)} disabled={busy} accessibilityRole="button">
            <Text style={[styles.primaryText, { color: c.onPrimary }]}>
              {i + 1 < duel.questions.length ? 'Next' : busy ? 'Saving…' : 'See who won'}
            </Text>
          </Pressable>
        )}
      </FormScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.m },
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
  title: { fontFamily: font.display, fontSize: 26, lineHeight: 30 },
  h2: { fontFamily: font.display, fontSize: 20, marginTop: space.m },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  meta: { fontFamily: font.medium, fontSize: 12 },
  row: { flexDirection: 'row', gap: space.m, alignItems: 'center' },
  make: { flex: 1, borderRadius: radius.card, padding: space.l, gap: space.s, minHeight: 110, justifyContent: 'space-between' },
  makeText: { fontFamily: font.bold, fontSize: 15 },
  code: { flex: 1, height: 52, borderRadius: radius.tile, fontFamily: font.bold, fontSize: 22, letterSpacing: 6, textAlign: 'center' },
  go: { height: 52, borderRadius: radius.pill, paddingHorizontal: space.xl, justifyContent: 'center' },
  recent: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderWidth: 1, borderRadius: radius.tile, padding: space.m },
  recentCode: { fontFamily: font.bold, fontSize: 15, letterSpacing: 2 },
  score: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderWidth: 1.5, borderRadius: radius.card, padding: space.m },
  place: { fontFamily: font.display, fontSize: 20, width: 24, textAlign: 'center' },
  name: { flex: 1, fontFamily: font.bold, fontSize: 15 },
  big: { fontFamily: font.display, fontSize: 22 },
  photoWrap: { borderRadius: radius.card, overflow: 'hidden', aspectRatio: 4 / 3 },
  photo: { width: '100%', height: '100%' },
  option: { borderWidth: 1.5, borderRadius: radius.tile, padding: space.m },
  optionText: { fontFamily: font.semibold, fontSize: 15 },
  primary: {
    flexDirection: 'row',
    gap: space.s,
    height: 52,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: font.semibold, fontSize: 15 },
});
