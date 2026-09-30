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
import { saveQuiz } from '@/state/quizStore';
import { font, radius, space, tileFor, useColors } from '@/theme';
import { answerFeel } from '@/lib/haptics';

// Zoom per stage: a close crop first, the whole photo last. Points for a right answer at each stage.
const ZOOM = [3.2, 2.2, 1.5, 1];
const POINTS = [4, 3, 2, 1];
const ROUNDS = 8;

/** QZ-09 partial view: the photo starts as a close crop and opens up; name the bird early for more points. */
export default function Reveal() {
  const c = useColors();
  const { session } = useAuth();
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [error, setError] = useState(false);
  const [i, setI] = useState(0);
  const [stage, setStage] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [record, setRecord] = useState(false);
  const [focus, setFocus] = useState<{ x: number; y: number }[]>([]); // where each crop is centred, per question
  const results = useRef<{ speciesId: number; correct: boolean }[]>([]);
  const [game, setGame] = useState(0);

  useEffect(() => {
    getQuiz('picture', { token: session?.token }).then(
      (r) => {
        const qs = r.questions.filter((q) => q.image).slice(0, ROUNDS);
        setQuestions(qs);
        // near the middle, where the bird usually is, but not dead centre
        setFocus(qs.map(() => ({ x: (Math.random() - 0.5) * 0.35, y: (Math.random() - 0.5) * 0.35 })));
      },
      () => setError(true),
    );
  }, [game, session?.token]);

  if (error || (questions && !questions.length)) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}>
        <Text style={[styles.body, { color: c.inkMuted }]}>
          {error ? 'Couldn’t load the birds. Check your connection.' : 'No quiz photos yet.'}
        </Text>
        <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={close} accessibilityRole="button">
          <Text style={[styles.primaryText, { color: c.onPrimary }]}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  if (!questions) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.accent} />
      </SafeAreaView>
    );
  }
  if (i >= questions.length) {
    const best = bestScores().reveal ?? score;
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}>
        <Feather name="eye" size={40} color={c.accent} />
        <Text style={[styles.big, { color: c.ink }]}>{score}</Text>
        <Text style={[styles.body, { color: c.inkMuted }]}>
          points of {questions.length * POINTS[0]} · {record ? 'a new best!' : `your best: ${best}`}
        </Text>
        <Pressable
          style={[styles.primary, { backgroundColor: c.primary }]}
          onPress={() => {
            results.current = [];
            setQuestions(null);
            setI(0);
            setStage(0);
            setPicked(null);
            setScore(0);
            setRecord(false);
            setGame(game + 1);
          }}
          accessibilityRole="button"
        >
          <Text style={[styles.primaryText, { color: c.onPrimary }]}>Play again</Text>
        </Pressable>
        <Pressable onPress={close} accessibilityRole="button">
          <Text style={[styles.link, { color: c.inkMuted }]}>Done</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const q = questions[i];
  const answered = picked !== null;
  const right = picked === q.answer.id;
  const zoom = answered ? 1 : ZOOM[stage];
  const f = focus[i] ?? { x: 0, y: 0 };
  const choose = (id: number) => {
    if (answered) return;
    setPicked(id);
    const ok = id === q.answer.id;
    answerFeel(ok);
    results.current.push({ speciesId: q.answer.id, correct: ok });
    if (ok) setScore(score + POINTS[stage]);
  };
  const next = () => {
    const done = i + 1 >= questions.length;
    if (done) {
      setRecord(recordScore('reveal', score));
      saveQuiz(results.current, session?.token, 'picture').catch(() => {});
    }
    setI(i + 1);
    setStage(0);
    setPicked(null);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={styles.top}>
        <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Quit">
          <Feather name="x" size={24} color={c.ink} />
        </Pressable>
        <Text style={[styles.kicker, { color: c.accentDeep }]}>
          REVEAL · {i + 1}/{questions.length}
        </Text>
        <Text style={[styles.score, { color: c.ink }]}>★ {score}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[styles.photoWrap, { backgroundColor: tileFor(c, q.answer.id) }]}
          accessibilityLabel={answered ? 'The whole photo' : `A close-up, stage ${stage + 1} of 4`}
        >
          <Image
            source={{ uri: mediaUrl(q.image!.url) }}
            style={[
              styles.photo,
              // move the crop's centre towards the middle before zooming, so the close-up shows part of the bird
              {
                transform: [
                  { scale: zoom },
                  { translateX: `${(-f.x * 100 * (zoom - 1)) / zoom}%` },
                  { translateY: `${(-f.y * 100 * (zoom - 1)) / zoom}%` },
                ],
              },
            ]}
            contentFit="cover"
          />
        </View>
        {!answered && (
          <View style={styles.stages}>
            {POINTS.map((p, k) => (
              <View key={k} style={[styles.stage, { backgroundColor: k <= stage ? c.accent : c.field }]}>
                <Text style={[styles.stageText, { color: k <= stage ? c.onAccent : c.inkMuted }]}>
                  {p} pt{p > 1 ? 's' : ''}
                </Text>
              </View>
            ))}
          </View>
        )}
        {!answered && stage < ZOOM.length - 1 && (
          <Pressable onPress={() => setStage(stage + 1)} style={[styles.more, { borderColor: c.primary }]} accessibilityRole="button">
            <Feather name="maximize-2" size={16} color={c.ink} />
            <Text style={[styles.moreText, { color: c.ink }]}>
              Reveal more ({POINTS[stage + 1]} pt{POINTS[stage + 1] > 1 ? 's' : ''} left)
            </Text>
          </Pressable>
        )}
        <View style={{ gap: space.s }}>
          {q.options.map((o) => {
            const isAnswer = o.id === q.answer.id;
            const bg = !answered ? c.bg : isAnswer ? '#E3F5EC' : o.id === picked ? '#FDE8E8' : c.bg;
            const border = !answered ? c.border : isAnswer ? c.correct : o.id === picked ? c.wrong : c.border;
            return (
              <Pressable
                key={o.id}
                style={[styles.option, { backgroundColor: bg, borderColor: border }]}
                onPress={() => choose(o.id)}
                disabled={answered}
                accessibilityRole="button"
              >
                <Text style={[styles.optionText, { color: c.ink }]}>{o.english_name}</Text>
              </Pressable>
            );
          })}
        </View>
        {answered && (
          <Text style={[styles.verdict, { color: right ? c.correct : c.wrong }]}>
            {right ? `+${POINTS[stage]} · ${stage === 0 ? 'from a close-up!' : 'well named'}` : `It was the ${q.answer.english_name}`}
          </Text>
        )}
      </ScrollView>
      {answered && (
        <View style={styles.bottom}>
          <Pressable
            style={[styles.primary, { backgroundColor: c.primary, alignSelf: 'stretch' }]}
            onPress={next}
            accessibilityRole="button"
          >
            <Text style={[styles.primaryText, { color: c.onPrimary }]}>{i + 1 < questions.length ? 'Next bird' : 'See score'}</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.m },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.screen, paddingVertical: space.m },
  kicker: { flex: 1, fontFamily: font.bold, fontSize: 12, letterSpacing: 1, textAlign: 'center' },
  score: { fontFamily: font.display, fontSize: 18 },
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 3 },
  photoWrap: { borderRadius: radius.card, overflow: 'hidden', aspectRatio: 4 / 3 },
  photo: { width: '100%', height: '100%' },
  stages: { flexDirection: 'row', gap: 6 },
  stage: { flex: 1, borderRadius: radius.pill, paddingVertical: 4, alignItems: 'center' },
  stageText: { fontFamily: font.semibold, fontSize: 11 },
  more: {
    flexDirection: 'row',
    gap: space.s,
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  moreText: { fontFamily: font.semibold, fontSize: 14 },
  option: { borderWidth: 1.5, borderRadius: radius.tile, padding: space.m },
  optionText: { fontFamily: font.semibold, fontSize: 15 },
  verdict: { fontFamily: font.display, fontSize: 20, textAlign: 'center' },
  bottom: { position: 'absolute', left: space.screen, right: space.screen, bottom: space.xl },
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
  big: { fontFamily: font.display, fontSize: 64 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  link: { fontFamily: font.semibold, fontSize: 14, marginTop: space.s },
});
