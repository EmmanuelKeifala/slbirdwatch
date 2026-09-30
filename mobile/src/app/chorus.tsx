import { Feather } from '@expo/vector-icons';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { chorusQuiz, mediaUrl, type ChorusRound } from '@/api';
import { useAuth } from '@/auth';
import { close } from '@/nav';
import { Pressable } from '@/Pressable';
import { saveQuiz } from '@/quizStore';
import { font, radius, space, useColors } from '@/theme';
import { answerFeel } from '@/haptics';

/** QZ-10 dawn chorus: two or three songs at once; tick every bird you hear. */
export default function Chorus() {
  const c = useColors();
  const { session } = useAuth();
  const [rounds, setRounds] = useState<ChorusRound[] | null>(null);
  const [error, setError] = useState(false);
  const [i, setI] = useState(0);
  const [ticked, setTicked] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  const [score, setScore] = useState(0);
  const [playing, setPlaying] = useState(false);
  const players = useRef<AudioPlayer[]>([]);
  const results = useRef<{ speciesId: number; correct: boolean }[]>([]);
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    chorusQuiz().then(
      (r) => setRounds(r.rounds),
      () => setError(true),
    );
  }, []);

  const stop = () => {
    for (const p of players.current) {
      p.pause();
      p.remove();
    }
    players.current = [];
    setPlaying(false);
  };
  useEffect(() => stop, []); // leaving the screen stops the birds

  useEffect(() => {
    if (!playing) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [playing, pulse]);

  const round = rounds?.[i];
  const play = () => {
    if (!round) return;
    if (playing) return stop();
    players.current = round.songs.map((s) => {
      const p = createAudioPlayer(mediaUrl(s.url));
      p.loop = true;
      p.volume = 0.8;
      return p;
    });
    players.current.forEach((p) => p.play()); // together, like a real morning
    setPlaying(true);
  };

  if (error || (rounds && rounds.length === 0)) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}>
        <Text style={[styles.body, { color: c.inkMuted }]}>
          {error ? 'Couldn’t load the songs. Check your connection.' : 'No songs yet.'}
        </Text>
        <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={close} accessibilityRole="button">
          <Text style={[styles.primaryText, { color: c.onPrimary }]}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  if (!rounds || !round) {
    if (rounds && i >= rounds.length) {
      return (
        <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}>
          <Feather name="sunrise" size={40} color={c.accent} />
          <Text style={[styles.big, { color: c.ink }]}>
            {score} / {rounds.length}
          </Text>
          <Text style={[styles.body, { color: c.inkMuted }]}>
            choruses fully named. Picking voices out of a crowd takes practice: keep at it.
          </Text>
          <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={close} accessibilityRole="button">
            <Text style={[styles.primaryText, { color: c.onPrimary }]}>Done</Text>
          </Pressable>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.accent} />
      </SafeAreaView>
    );
  }

  const answerIds = round.answer.map((a) => a.id);
  const check = () => {
    const all = answerIds.every((id) => ticked.includes(id)) && ticked.every((id) => answerIds.includes(id));
    answerFeel(all);
    if (all) setScore(score + 1);
    for (const id of answerIds) results.current.push({ speciesId: id, correct: ticked.includes(id) });
    setChecked(true);
  };
  const next = () => {
    stop();
    if (i + 1 >= rounds.length) saveQuiz(results.current, session?.token, 'sound').catch(() => {});
    setI(i + 1);
    setTicked([]);
    setChecked(false);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={styles.top}>
        <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Quit">
          <Feather name="x" size={24} color={c.ink} />
        </Pressable>
        <Text style={[styles.kicker, { color: c.accentDeep }]}>
          DAWN CHORUS · {i + 1}/{rounds.length}
        </Text>
        <Text style={[styles.score, { color: c.ink }]}>★ {score}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.question, { color: c.ink }]}>{round.songs.length} birds are singing. Which ones?</Text>
        <Pressable
          onPress={play}
          style={styles.playWrap}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Stop the chorus' : 'Play the chorus'}
        >
          <Animated.View
            style={[
              styles.ring,
              { backgroundColor: c.accent },
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }],
              },
            ]}
          />
          <View style={[styles.play, { backgroundColor: c.primary }]}>
            <Feather name={playing ? 'pause' : 'play'} size={34} color={c.onPrimary} style={!playing && { marginLeft: 4 }} />
          </View>
        </Pressable>
        <Text style={[styles.hint, { color: c.inkMuted }]}>
          {playing ? 'Listening… tap to stop' : 'Tap to play them all together'} · pick {round.songs.length} ({ticked.length} picked)
        </Text>

        <View style={styles.grid}>
          {round.options.map((o) => {
            const on = ticked.includes(o.id);
            const singer = answerIds.includes(o.id);
            const bg = !checked ? (on ? c.tint : c.bg) : singer ? '#E3F5EC' : on ? '#FDE8E8' : c.bg;
            const border = !checked ? (on ? c.accent : c.border) : singer ? c.correct : on ? c.wrong : c.border;
            return (
              <Pressable
                key={o.id}
                disabled={checked || (!on && ticked.length >= round.songs.length)} // n singers: at most n ticks
                onPress={() => setTicked(on ? ticked.filter((x) => x !== o.id) : [...ticked, o.id])}
                style={[styles.option, { backgroundColor: bg, borderColor: border }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <Feather name={on ? 'check-square' : 'square'} size={18} color={on ? c.accentDeep : c.inkFaint} />
                <Text style={[styles.optionText, { color: c.ink }]} numberOfLines={2}>
                  {o.english_name}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {checked && (
          <View style={[styles.explain, { backgroundColor: c.tint }]}>
            <Text style={[styles.body, { color: c.ink }]}>Singing: {round.answer.map((a) => a.english_name).join(', ')}.</Text>
            <Text style={[styles.hint, { color: c.inkMuted, textAlign: 'left' }]}>
              {round.songs.map((s) => `${s.credit} · ${s.licence}`).join(' / ')} · xeno-canto.org
            </Text>
          </View>
        )}
      </ScrollView>
      <View style={styles.bottom}>
        <Pressable
          style={[styles.primary, { backgroundColor: c.primary, alignSelf: 'stretch' }, !checked && !ticked.length && { opacity: 0.4 }]}
          disabled={!checked && !ticked.length}
          onPress={checked ? next : check}
          accessibilityRole="button"
        >
          <Text style={[styles.primaryText, { color: c.onPrimary }]}>
            {!checked ? 'Check' : i + 1 < rounds.length ? 'Next chorus' : 'See score'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.m },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.screen, paddingVertical: space.m },
  kicker: { flex: 1, fontFamily: font.bold, fontSize: 12, letterSpacing: 1, textAlign: 'center' },
  score: { fontFamily: font.display, fontSize: 18 },
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 3, alignItems: 'stretch' },
  question: { fontFamily: font.display, fontSize: 24, lineHeight: 28 },
  playWrap: { alignSelf: 'center', width: 110, height: 110, alignItems: 'center', justifyContent: 'center', marginVertical: space.m },
  ring: { position: 'absolute', width: 110, height: 110, borderRadius: 55 },
  play: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  hint: { fontFamily: font.medium, fontSize: 12, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  option: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    borderWidth: 1.5,
    borderRadius: radius.tile,
    padding: space.m,
    minHeight: 58,
  },
  optionText: { flex: 1, fontFamily: font.semibold, fontSize: 14 },
  explain: { borderRadius: radius.card, padding: space.l, gap: space.s },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  bottom: { position: 'absolute', left: space.screen, right: space.screen, bottom: space.xl },
  primary: {
    height: 52,
    minWidth: 200,
    borderRadius: radius.pill,
    paddingHorizontal: space.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: font.semibold, fontSize: 15 },
  big: { fontFamily: font.display, fontSize: 56 },
});
