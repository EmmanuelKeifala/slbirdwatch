import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';

import { Pressable } from '@/Pressable';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getQuiz, isVerifier, mediaUrl, setQuizSuitable, type QuizQuestion, type QuizScope } from '@/api';
import { useAuth } from '@/auth';
import { close } from '@/nav';
import { addToDeck } from '@/deck';
import { FormScroll } from '@/FormScroll';
import { matchName } from '@/fuzzy';
import { recordLesson } from '@/lessonStore';
import { lookups } from '@/lookups';
import { quizLevel, quizTyping, setQuizLevel, setQuizTyping, type QuizLevel } from '@/quizLevel';
import { currentStats, saveQuiz } from '@/quizStore';
import { SoundPlayer } from '@/SoundPlayer';
import { accuracy, type QuizStats } from '@/stats';
import { font, radius, space, tileFor, useColors } from '@/theme';
import { answerFeel } from '@/haptics';

// QZ-03
const LEVELS: { level: QuizLevel; label: string; hint: string }[] = [
  { level: 'beginner', label: 'Beginner', hint: 'Common birds, clear views' },
  { level: 'intermediate', label: 'Intermediate', hint: 'A mix, with lookalikes' },
  { level: 'expert', label: 'Expert', hint: 'Young birds, females, flight views, alarm calls' },
];

const REASON: Record<QuizQuestion['reason'], { icon: ComponentProps<typeof Feather>['name']; text: string } | undefined> = {
  weak: { icon: 'target', text: 'You’ve missed this one before' }, // QZ-14
  community: { icon: 'users', text: 'Recorded by the community lately' },
  yours: { icon: 'bookmark', text: 'A bird you looked up or missed' },
  local: { icon: 'map-pin', text: 'Found in Sierra Leone' },
  '': undefined,
};

/** QZ-01 picture / QZ-02 sound quiz (`?kind=sound`), explanation after each answer (QZ-06), saved on the device (QZ-13). */
export default function Quiz() {
  const c = useColors();
  const {
    kind,
    family = '',
    scope = '',
    species = '',
    lesson = '',
    habitat = '',
    season = '',
    lat,
    lng,
    group,
  } = useLocalSearchParams<{
    kind?: string;
    family?: string;
    scope?: QuizScope;
    habitat?: string; // QZ-04
    season?: '' | 'rainy' | 'dry';
    lat?: string; // scope=near
    group?: string; // scope=group (COM-03)
    lng?: string;
    species?: string; // LRN-02: a lesson's birds, comma-separated
    lesson?: string;
  }>();
  const sound = kind === 'sound';
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [results, setResults] = useState<{ speciesId: number; correct: boolean }[]>([]);
  const [done, setDone] = useState<QuizStats | null>(null);
  const [round, setRound] = useState(0);
  const { session } = useAuth();
  const [hidden, setHidden] = useState<string[]>([]); // media refs a verifier pulled from quizzes this round
  const [level, setLevel] = useState<QuizLevel>(quizLevel);
  const [typing, setTyping] = useState(quizTyping); // QZ-05
  const [typed, setTyped] = useState('');
  const [verdict, setVerdict] = useState<'exact' | 'close' | 'wrong' | null>(null);

  useEffect(() => {
    getQuiz(sound ? 'sound' : 'picture', {
      family,
      scope,
      species: species ? species.split(',').map(Number) : [],
      focus: [...lookups(), ...Object.keys(currentStats().missed).map(Number)],
      level,
      habitat,
      season,
      near: lat && lng ? { lat: Number(lat), lng: Number(lng) } : undefined,
      group: group ? Number(group) : undefined,
      token: session?.token,
    })
      .then((r) => setQuestions(r.questions))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [round, sound, family, scope, species, level, habitat, season, lat, lng, group, session?.token]);

  function pickLevel(l: QuizLevel) {
    if (l === level) return;
    setQuizLevel(l);
    setLevel(l);
    restart();
  }

  function restart() {
    setQuestions(null);
    setI(0);
    setPicked(null);
    setTyped('');
    setVerdict(null);
    setResults([]);
    setDone(null);
    setRound(round + 1);
  }

  if (error || (questions && questions.length === 0)) {
    return (
      <Centered>
        <Text style={[styles.body, { color: c.inkMuted, textAlign: 'center' }]}>
          {error
            ? 'Couldn’t load the quiz. Check your connection.'
            : scope === 'week'
              ? 'No birds recorded by the community in the last 30 days have quiz media yet. Go out, log what you see, and check back.'
              : scope === 'mine'
                ? 'None of the birds you looked up have quiz media yet. Try the mixed quiz.'
                : scope === 'lifelist'
                  ? 'Log a few sightings first: this quiz uses the birds on your life list.'
                  : scope === 'near' || habitat || season
                    ? 'No quiz media for these birds yet. Try a bigger area or another quiz.'
                    : sound
                      ? 'No verified bird calls yet. As the community verifies recordings, they’ll show up here.'
                      : 'No quiz photos yet. Try again later.'}
        </Text>
        <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={close} accessibilityRole="button">
          <Text style={[styles.primaryText, { color: c.onPrimary }]}>Back</Text>
        </Pressable>
      </Centered>
    );
  }
  if (!questions) {
    return (
      <Centered>
        <ActivityIndicator color={c.accent} />
      </Centered>
    );
  }

  if (done) {
    const right = results.filter((r) => r.correct).length;
    return (
      <Centered>
        <Text style={[styles.count, { color: c.inkMuted }]}>{LEVELS.find((l) => l.level === level)?.label} round</Text>
        <Text style={[styles.big, { color: c.ink }]}>
          {right} / {results.length}
        </Text>
        <Text style={[styles.body, { color: c.inkMuted, textAlign: 'center' }]}>
          {right === results.length ? 'Perfect round!' : right >= results.length * 0.7 ? 'Sharp eyes.' : 'Keep practising, it adds up.'}
          {'\n'}Overall accuracy {accuracy(done)}% · best streak {done.bestStreak}
        </Text>
        <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={restart} accessibilityRole="button">
          <Text style={[styles.primaryText, { color: c.onPrimary }]}>Play again</Text>
        </Pressable>
        <Pressable onPress={close} accessibilityRole="button">
          <Text style={[styles.link, { color: c.inkMuted }]}>Done</Text>
        </Pressable>
      </Centered>
    );
  }

  const q = questions[i];
  const why = REASON[q.reason];
  const answered = typing ? verdict !== null : picked !== null;
  const correct = typing ? verdict === 'exact' || verdict === 'close' : picked === q.answer.id;

  function choose(id: number) {
    if (answered) return;
    setPicked(id);
    answerFeel(id === q.answer.id);
    setResults([...results, { speciesId: q.answer.id, correct: id === q.answer.id }]);
  }

  function check() {
    if (answered || typed.trim().length < 3) return;
    const v = matchName(typed, [q.answer.english_name, q.answer.scientific_name]);
    setVerdict(v);
    answerFeel(v !== 'wrong');
    setResults([...results, { speciesId: q.answer.id, correct: v !== 'wrong' }]);
  }

  function next() {
    if (i + 1 < questions!.length) {
      setI(i + 1);
      setPicked(null);
      setTyped('');
      setVerdict(null);
    } else {
      addToDeck(results.filter((r) => !r.correct).map((r) => r.speciesId)); // LRN-04: misses become flashcards
      if (lesson && results.length) recordLesson(lesson, Math.round((100 * results.filter((r) => r.correct).length) / results.length));
      saveQuiz(results, session?.token, sound ? 'sound' : 'picture').then(setDone);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={styles.top}>
        <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Quit quiz">
          <Feather name="x" size={24} color={c.ink} />
        </Pressable>
        <View style={[styles.track, { backgroundColor: c.tint }]}>
          <View style={[styles.fill, { backgroundColor: c.accent, width: `${((i + (answered ? 1 : 0)) / questions.length) * 100}%` }]} />
        </View>
        <Text style={[styles.count, { color: c.inkMuted }]}>
          {i + 1}/{questions.length}
        </Text>
      </View>

      <FormScroll contentContainerStyle={styles.content}>
        <Text style={[styles.question, { color: c.ink }]} accessibilityRole="header">
          {sound ? 'Which bird is calling?' : 'Which bird is this?'}
        </Text>
        {i === 0 && !answered && (
          <View style={{ gap: 6 }}>
            <View style={styles.levels}>
              {LEVELS.map((l) => {
                const on = l.level === level;
                return (
                  <Pressable
                    key={l.level}
                    onPress={() => pickLevel(l.level)}
                    style={[styles.level, { backgroundColor: on ? c.primary : c.field }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityHint={l.hint}
                  >
                    <Text style={[styles.levelText, { color: on ? c.onPrimary : c.ink }]}>{l.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.credit, { color: c.inkMuted }]}>{LEVELS.find((l) => l.level === level)?.hint}</Text>
            <View style={styles.levels}>
              {([false, true] as const).map((t) => {
                const on = typing === t;
                return (
                  <Pressable
                    key={String(t)}
                    onPress={() => {
                      setTyping(t);
                      setQuizTyping(t);
                    }}
                    style={[styles.level, { backgroundColor: on ? c.accent : c.field }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.levelText, { color: on ? c.onAccent : c.ink }]}>{t ? 'Type the name' : 'Pick from 4'}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        {why && (
          <View style={[styles.reason, { backgroundColor: c.tint }]}>
            <Feather name={why.icon} size={12} color={c.tintIcon} />
            <Text style={[styles.reasonText, { color: c.ink }]}>{why.text}</Text>
          </View>
        )}
        {q.sound ? (
          <View style={[styles.soundWrap, { backgroundColor: tileFor(c, q.answer.id) }]}>
            <SoundPlayer
              key={q.media_ref}
              sound={{ url: q.sound.url, spectrogram_url: q.sound.spectrogram_url, duration_s: 0 }}
              caption={`${q.sound.credit} · ${q.sound.licence}`}
            />
          </View>
        ) : (
          q.image && (
            <>
              <View style={[styles.photoWrap, { backgroundColor: tileFor(c, q.answer.id) }]}>
                <Image
                  source={{ uri: mediaUrl(q.image.url) }}
                  style={styles.photo}
                  contentFit="cover"
                  accessibilityLabel="Bird photo to identify"
                />
              </View>
              <Text style={[styles.credit, { color: c.inkFaint }]} numberOfLines={1}>
                Photo: {q.image.credit || 'Unknown'} · {q.image.licence}
              </Text>
            </>
          )
        )}

        {typing ? (
          <View style={{ gap: space.s }}>
            <TextInput
              style={[
                styles.typeInput,
                { color: c.ink, borderColor: !answered ? c.border : correct ? c.correct : c.wrong, backgroundColor: c.field },
              ]}
              value={typed}
              onChangeText={setTyped}
              editable={!answered}
              placeholder="Common or scientific name"
              placeholderTextColor={c.inkFaint}
              autoCorrect={false}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={check}
              accessibilityLabel="Type the bird's name"
            />
            {!answered && (
              <Pressable
                style={[styles.primary, { backgroundColor: c.primary }, typed.trim().length < 3 && { opacity: 0.4 }]}
                onPress={check}
                disabled={typed.trim().length < 3}
                accessibilityRole="button"
              >
                <Text style={[styles.primaryText, { color: c.onPrimary }]}>Check</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={{ gap: space.s }}>
            {q.options.map((o) => {
              const isAnswer = o.id === q.answer.id;
              const isPicked = o.id === picked;
              const bg = !answered ? c.bg : isAnswer ? '#E3F5EC' : isPicked ? '#FDE8E8' : c.bg;
              const border = !answered ? c.border : isAnswer ? c.correct : isPicked ? c.wrong : c.border;
              return (
                <Pressable
                  key={o.id}
                  style={({ pressed }) => [
                    styles.option,
                    { backgroundColor: bg, borderColor: border },
                    pressed && !answered && { opacity: 0.8 },
                  ]}
                  onPress={() => choose(o.id)}
                  disabled={answered}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isPicked }}
                  accessibilityHint={answered ? (isAnswer ? 'Correct answer' : undefined) : undefined}
                >
                  <Text style={[styles.optionText, { color: c.ink }]}>{o.english_name}</Text>
                  {answered && isAnswer && <Feather name="check" size={18} color={c.correct} />}
                  {answered && isPicked && !isAnswer && <Feather name="x" size={18} color={c.wrong} />}
                </Pressable>
              );
            })}
          </View>
        )}

        {answered && (
          <View style={[styles.explain, { backgroundColor: c.tiles[correct ? 1 : 2] }]} accessibilityLiveRegion="polite">
            <Text style={[styles.verdict, { color: correct ? c.correct : c.wrong }]}>
              {correct ? (verdict === 'close' ? 'Correct! Watch the spelling:' : 'Correct!') : 'Not quite'}
            </Text>
            <Text style={[styles.answer, { color: c.ink }]}>{q.answer.english_name}</Text>
            <Text style={[styles.sci, { color: c.inkMuted }]}>{q.answer.scientific_name}</Text>
            <Text style={[styles.body, { color: c.ink }]}>{q.explanation}</Text>
            <Pressable onPress={() => router.push(`/species/${q.answer.id}`)} accessibilityRole="link">
              <Text style={[styles.link, { color: c.accentDeep, textAlign: 'left' }]}>More about this bird</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/compare',
                  params: { ids: [q.answer.id, ...q.options.filter((o) => o.id !== q.answer.id).map((o) => o.id)].slice(0, 3).join(',') },
                })
              }
              accessibilityRole="link"
            >
              <Text style={[styles.link, { color: c.accentDeep, textAlign: 'left' }]}>Compare with the lookalikes</Text>
            </Pressable>
            {isVerifier(session?.user) &&
              (hidden.includes(q.media_ref) ? (
                <Text style={[styles.link, { color: c.inkMuted, textAlign: 'left' }]}>Removed from quizzes</Text>
              ) : (
                <Pressable
                  onPress={() =>
                    setQuizSuitable(session!.token, q.media_ref, false)
                      .then(() => setHidden([...hidden, q.media_ref]))
                      .catch(() => {})
                  }
                  accessibilityRole="button"
                >
                  <Text style={[styles.link, { color: c.wrong, textAlign: 'left' }]}>Not suitable for quizzes</Text>
                </Pressable>
              ))}
          </View>
        )}
      </FormScroll>

      {answered && (
        <View style={styles.bottom}>
          <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={next} accessibilityRole="button">
            <Text style={[styles.primaryText, { color: c.onPrimary }]}>{i + 1 < questions.length ? 'Next' : 'See results'}</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <SafeAreaView style={[styles.centered, { backgroundColor: c.bg }]}>{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  typeInput: { borderWidth: 2, borderRadius: radius.tile, paddingHorizontal: space.l, height: 54, fontFamily: font.semibold, fontSize: 16 },
  levels: { flexDirection: 'row', gap: space.s },
  level: { flex: 1, borderRadius: radius.pill, height: 36, alignItems: 'center', justifyContent: 'center' },
  levelText: { fontFamily: font.semibold, fontSize: 13 },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: space.m,
    paddingVertical: 5,
    marginTop: -space.s,
    marginBottom: space.s,
  },
  reasonText: { fontFamily: font.semibold, fontSize: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.l },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.screen, height: 56 },
  track: { flex: 1, height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  count: { fontFamily: font.semibold, fontSize: 13, minWidth: 36, textAlign: 'right' },
  content: { paddingHorizontal: space.screen, paddingBottom: 120, gap: space.m },
  question: { fontFamily: font.display, fontSize: 30, lineHeight: 34, marginTop: space.s },
  photoWrap: { height: 260, borderRadius: radius.card, overflow: 'hidden' },
  soundWrap: { borderRadius: radius.card, padding: space.l },
  photo: { width: '100%', height: '100%' },
  credit: { fontFamily: font.medium, fontSize: 11, textAlign: 'right' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 54,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingHorizontal: space.xl,
  },
  optionText: { fontFamily: font.semibold, fontSize: 15, flex: 1 },
  explain: { borderRadius: radius.card, padding: space.xl, gap: 4, marginTop: space.s },
  verdict: { fontFamily: font.bold, fontSize: 14 },
  answer: { fontFamily: font.display, fontSize: 24, marginTop: 2 },
  sci: { fontFamily: font.italic, fontSize: 13, marginBottom: space.s },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  big: { fontFamily: font.display, fontSize: 56 },
  bottom: { position: 'absolute', left: space.screen, right: space.screen, bottom: space.xl },
  primary: { height: 56, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  primaryText: { fontFamily: font.semibold, fontSize: 16 },
  link: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center', paddingVertical: space.s },
});
