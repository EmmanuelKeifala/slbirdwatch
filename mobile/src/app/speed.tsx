import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getQuiz, mediaUrl, type QuizQuestion } from '@/api';
import { useAuth } from '@/state/auth';
import { bestScores, recordScore } from '@/state/gameScores';
import { close } from '@/lib/nav';
import { Pressable } from '@/components/Pressable';
import { GameBar } from '@/components/GameBar';
import { saveQuiz } from '@/state/quizStore';
import { font, radius, space, tileFor, useColors } from '@/theme';
import { answerFeel } from '@/lib/haptics';

const SECONDS = 60;
const PENALTY = 3; // seconds off for a wrong answer

/** QZ-08 speed round: name as many birds as you can in a minute. Wrong answers cost 3 seconds. */
export default function Speed() {
  const c = useColors();
  const { session } = useAuth();
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [error, setError] = useState(false);
  const [state, setState] = useState<'ready' | 'playing' | 'over'>('ready');
  const [left, setLeft] = useState(SECONDS);
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const endAt = useRef(0); // the clock runs from an end time, so penalties just move it
  const scoreRef = useRef(0);
  const [flash, setFlash] = useState<{ id: number; right: boolean } | null>(null);
  const [record, setRecord] = useState(false);
  const results = useRef<{ speciesId: number; correct: boolean }[]>([]);
  const [game, setGame] = useState(0);

  useEffect(() => {
    // two batches of 20 so fast players don't run out
    Promise.all([getQuiz('picture', { token: session?.token }), getQuiz('picture', { token: session?.token })]).then(
      ([a, b]) => setQuestions([...a.questions, ...b.questions.filter((q) => !a.questions.some((x) => x.media_ref === q.media_ref))]),
      () => setError(true),
    );
  }, [game, session?.token]);

  const finish = () => {
    setState('over');
    setRecord(recordScore('speed', scoreRef.current));
    if (results.current.length) saveQuiz(results.current, session?.token, 'picture').catch(() => {});
  };
  const start = () => {
    endAt.current = Date.now() + SECONDS * 1000;
    setLeft(SECONDS);
    setState('playing');
  };
  useEffect(() => {
    if (state !== 'playing') return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) finish();
    }, 250);
    return () => clearInterval(t);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (id: number) => {
    if (!questions || flash) return;
    const q = questions[i];
    const right = id === q.answer.id;
    answerFeel(right);
    results.current.push({ speciesId: q.answer.id, correct: right });
    if (right) {
      scoreRef.current += 1;
      setScore(scoreRef.current);
    } else endAt.current -= PENALTY * 1000;
    setFlash({ id, right });
    setTimeout(
      () => {
        setFlash(null);
        if (i + 1 >= questions.length) finish();
        else setI(i + 1);
      },
      right ? 250 : 700,
    ); // a wrong answer shows the right one a little longer
  };
  const again = () => {
    results.current = [];
    scoreRef.current = 0;
    setQuestions(null);
    setI(0);
    setScore(0);
    setLeft(SECONDS);
    setRecord(false);
    setState('ready');
    setGame(game + 1);
  };

  if (error) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}>
        <Text style={[styles.body, { color: c.inkMuted }]}>Couldn’t load the birds. Check your connection.</Text>
        <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={close} accessibilityRole="button">
          <Text style={[styles.primaryText, { color: c.onPrimary }]}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  if (state !== 'playing') {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}>
        <Feather name="zap" size={40} color={c.accent} />
        {state === 'over' ? (
          <>
            <Text style={[styles.big, { color: c.ink }]}>{score}</Text>
            <Text style={[styles.body, { color: c.inkMuted }]}>{record ? 'A new best!' : `Your best: ${bestScores().speed ?? score}`}</Text>
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: c.ink }]}>Speed round</Text>
            <Text style={[styles.body, { color: c.inkMuted }]}>
              Name as many birds as you can in {SECONDS} seconds. A wrong answer costs {PENALTY} seconds.
              {bestScores().speed ? `\nYour best: ${bestScores().speed}` : ''}
            </Text>
          </>
        )}
        <Pressable
          style={[styles.primary, { backgroundColor: c.primary }, !questions && { opacity: 0.4 }]}
          disabled={!questions}
          onPress={state === 'over' ? again : start}
          accessibilityRole="button"
        >
          {questions ? (
            <Text style={[styles.primaryText, { color: c.onPrimary }]}>{state === 'over' ? 'Play again' : 'Start'}</Text>
          ) : (
            <ActivityIndicator color={c.onPrimary} />
          )}
        </Pressable>
        <Pressable onPress={close} accessibilityRole="button">
          <Text style={[styles.link, { color: c.inkMuted }]}>Done</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const q = questions![Math.min(i, questions!.length - 1)];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <GameBar
        onClose={close}
        right={
          <>
            <Text style={[styles.clock, { color: left <= 10 ? c.wrong : c.ink }]} accessibilityLiveRegion="polite">
              {Math.max(0, left)}s
            </Text>
            <Text style={[styles.clock, { color: c.ink }]}>★ {score}</Text>
          </>
        }
      >
        <View style={[styles.track, { backgroundColor: c.tint }]}>
          <View style={[styles.fill, { backgroundColor: left <= 10 ? c.wrong : c.accent, width: `${(100 * left) / SECONDS}%` }]} />
        </View>
      </GameBar>
      <ScrollView contentContainerStyle={styles.content} scrollEnabled={false}>
        <View style={[styles.photoWrap, { backgroundColor: tileFor(c, q.answer.id) }]}>
          {q.image && (
            <Image source={{ uri: mediaUrl(q.image.url) }} style={styles.photo} contentFit="cover" accessibilityLabel="Bird to name" />
          )}
        </View>
        <View style={styles.grid}>
          {q.options.map((o) => {
            const bg = !flash ? c.field : o.id === q.answer.id ? '#E3F5EC' : o.id === flash.id ? '#FDE8E8' : c.field;
            return (
              <Pressable
                key={o.id}
                style={[styles.option, { backgroundColor: bg }]}
                onPress={() => answer(o.id)}
                accessibilityRole="button"
              >
                <Text style={[styles.optionText, { color: c.ink }]} numberOfLines={2}>
                  {o.english_name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.m },
  track: { flex: 1, height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 10, borderRadius: radius.pill },
  clock: { fontFamily: font.display, fontSize: 18, minWidth: 36, textAlign: 'right' },
  content: { padding: space.screen, gap: space.m },
  photoWrap: { borderRadius: radius.card, overflow: 'hidden', aspectRatio: 4 / 3 },
  photo: { width: '100%', height: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  option: { width: '48.5%', minHeight: 64, borderRadius: radius.tile, padding: space.m, justifyContent: 'center' },
  optionText: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center' },
  title: { fontFamily: font.display, fontSize: 30 },
  big: { fontFamily: font.display, fontSize: 64 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  primary: {
    height: 52,
    minWidth: 200,
    borderRadius: radius.pill,
    paddingHorizontal: space.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.m,
  },
  primaryText: { fontFamily: font.semibold, fontSize: 15 },
  link: { fontFamily: font.semibold, fontSize: 14, marginTop: space.s },
});
