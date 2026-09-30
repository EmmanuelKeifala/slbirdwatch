import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { Pressable } from '@/Pressable';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BirdArt } from '@/BirdArt';
import { listLessons, mediaUrl, type LessonSummary } from '@/api';
import { loadDeck } from '@/deck';
import { lessonScores, PASS } from '@/lessonStore';
import { dueCards } from '@/srs';
import { lookups } from '@/lookups';
import { useAuth } from '@/auth';
import { useQuizStats } from '@/quizStore';
import { QuizScopes } from '@/QuizScopes';
import { ScreenHeader } from '@/ScreenHeader';
import { accuracy } from '@/stats';
import { font, radius, space, useColors } from '@/theme';

/** Learn: quizzes and your progress. Works without an account (QZ-13). */
export default function Learn() {
  const c = useColors();
  const { session } = useAuth();
  const stats = useQuizStats(session?.token); // ACC-04: account progress + anything still on the phone
  const [looked, setLooked] = useState(0);
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [deck, setDeck] = useState(0);
  const [due, setDue] = useState(0);
  useEffect(() => {
    listLessons().then((r) => setLessons(r.items), () => {});
  }, []);
  useFocusEffect(
    useCallback(() => {
      setLooked(lookups().length);
      setScores(lessonScores());
      const d = loadDeck();
      setDeck(d.length);
      setDue(dueCards(d, Date.now()).length);
    }, []),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScreenHeader title="Learn" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.hero, { color: c.ink }]} accessibilityRole="header">
          Train your eye
        </Text>
        <Text style={[styles.lead, { color: c.inkMuted }]}>
          Name birds yourself instead of letting an app do it. Short rounds, real photos, an explanation after every
          answer.
        </Text>

        {session && (
          <Pressable
            style={({ pressed }) => [styles.cards, { backgroundColor: c.tiles[1] }, pressed && { transform: [{ scale: 0.98 }] }]}
            onPress={() => router.push('/lifelist')}
            accessibilityRole="button"
          >
            <View style={[styles.cardsIcon, { backgroundColor: 'rgba(255,255,255,0.75)' }]}>
              <Feather name="list" size={20} color={c.tintIcon} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardsTitle, { color: c.ink }]}>Your life list</Text>
              <Text style={[styles.cardBody, { color: c.inkMuted }]}>Birds you’ve seen, and which to learn next</Text>
            </View>
            <Feather name="chevron-right" size={20} color={c.inkMuted} />
          </Pressable>
        )}

        <Pressable
          style={({ pressed }) => [styles.cards, { backgroundColor: c.tiles[4] }, pressed && { transform: [{ scale: 0.98 }] }]}
          onPress={() => router.push('/glossary')}
          accessibilityRole="button"
        >
          <View style={[styles.cardsIcon, { backgroundColor: 'rgba(255,255,255,0.75)' }]}>
            <Feather name="book" size={20} color={c.tintIcon} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardsTitle, { color: c.ink }]}>Glossary</Text>
            <Text style={[styles.cardBody, { color: c.inkMuted }]}>Parts of a bird and birding words, with a diagram</Text>
          </View>
          <Feather name="chevron-right" size={20} color={c.inkMuted} />
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.cards, { backgroundColor: c.tiles[3] }, pressed && { transform: [{ scale: 0.98 }] }]}
          onPress={() => router.push('/flashcards')}
          accessibilityRole="button"
          accessibilityLabel={`Flashcards, ${due} due`}
        >
          <View style={[styles.cardsIcon, { backgroundColor: 'rgba(255,255,255,0.75)' }]}>
            <Feather name="layers" size={20} color={c.tintIcon} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardsTitle, { color: c.ink }]}>Flashcards</Text>
            <Text style={[styles.cardBody, { color: c.inkMuted }]}>
              {deck === 0 ? 'Birds you miss land here for spaced review' : due ? `${due} due now · ${deck} in your deck` : `All caught up · ${deck} in your deck`}
            </Text>
          </View>
          {due > 0 && (
            <View style={[styles.dueBadge, { backgroundColor: c.primary }]}>
              <Text style={[styles.dueText, { color: c.onPrimary }]}>{due}</Text>
            </View>
          )}
        </Pressable>


        {lessons.length > 0 && (
          <>
            <Text style={[styles.h2, { color: c.ink }]}>Lessons</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.m }} style={styles.bleed}>
              {lessons.map((l) => {
                const best = scores[l.slug];
                return (
                  <Pressable key={l.slug} onPress={() => router.push(`/lesson/${l.slug}`)} accessibilityRole="button" style={styles.lesson}>
                    {l.cover ? (
                      <Image source={{ uri: mediaUrl(l.cover) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : null}
                    <LinearGradient colors={['rgba(23,20,75,0.05)', 'rgba(23,20,75,0.85)']} style={StyleSheet.absoluteFill} />
                    {best !== undefined && (
                      <View style={[styles.done, { backgroundColor: best >= PASS ? c.correct : 'rgba(255,255,255,0.9)' }]}>
                        <Feather name={best >= PASS ? 'check' : 'rotate-ccw'} size={11} color={best >= PASS ? '#FFFFFF' : c.ink} />
                        <Text style={[styles.doneText, { color: best >= PASS ? '#FFFFFF' : c.ink }]}>{best}%</Text>
                      </View>
                    )}
                    <View style={{ padding: space.m }}>
                      <Text style={styles.lessonTitle} numberOfLines={2}>
                        {l.title}
                      </Text>
                      <Text style={styles.lessonSub}>{l.birds} birds</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        <Pressable
          onPress={() => router.push({ pathname: '/quiz', params: { scope: 'week' } })}
          accessibilityRole="button"
          accessibilityLabel="Start this month's birds quiz: birds the community recorded in the last 30 days"
        >
          <LinearGradient colors={[c.night[0], c.night[1], c.night[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.featured}>
            <View style={{ flex: 1, gap: space.s }}>
              <Text style={styles.kicker}>FROM OUR OUTINGS</Text>
              <Text style={[styles.cardTitle, { color: '#FFFFFF' }]}>This month’s birds</Text>
              <Text style={[styles.cardBody, { color: '#E3E0FF' }]}>
                Birds the community recorded in the last 30 days. Learn them before the next walk.
              </Text>
              <View style={[styles.start, { backgroundColor: '#FFFFFF' }]}>
                <Text style={[styles.startText, { color: c.ink }]}>Start</Text>
                <Feather name="arrow-right" size={16} color={c.ink} />
              </View>
            </View>
            <BirdArt id={11} size={96} />
          </LinearGradient>
        </Pressable>

        {looked >= 4 && (
          <Pressable
            style={({ pressed }) => [styles.card, { backgroundColor: c.tiles[4] }, pressed && { transform: [{ scale: 0.98 }] }]}
            onPress={() => router.push({ pathname: '/quiz', params: { scope: 'mine' } })}
            accessibilityRole="button"
            accessibilityLabel="Start a quiz on birds you looked up"
          >
            <View style={{ flex: 1, gap: space.s }}>
              <Text style={[styles.cardTitle, { color: c.ink }]}>Birds you looked up</Text>
              <Text style={[styles.cardBody, { color: c.inkMuted }]}>{looked} birds you opened, plus ones you got wrong</Text>
              <View style={[styles.start, { backgroundColor: c.primary }]}>
                <Text style={[styles.startText, { color: c.onPrimary }]}>Start</Text>
                <Feather name="arrow-right" size={16} color={c.onPrimary} />
              </View>
            </View>
            <Feather name="bookmark" size={56} color={c.tintIcon} />
          </Pressable>
        )}

        <Pressable
          style={({ pressed }) => [styles.card, { backgroundColor: c.tiles[0] }, pressed && { transform: [{ scale: 0.98 }] }]}
          onPress={() => router.push('/quiz')}
          accessibilityRole="button"
          accessibilityLabel="Start picture quiz, 10 questions"
        >
          <View style={{ flex: 1, gap: space.s }}>
            <Text style={[styles.cardTitle, { color: c.ink }]}>Picture quiz</Text>
            <Text style={[styles.cardBody, { color: c.inkMuted }]}>Your birds and Sierra Leone birds first, a few from anywhere</Text>
            <View style={[styles.start, { backgroundColor: c.primary }]}>
              <Text style={[styles.startText, { color: c.onPrimary }]}>Start</Text>
              <Feather name="arrow-right" size={16} color={c.onPrimary} />
            </View>
          </View>
          <BirdArt id={3} size={96} />
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, { backgroundColor: c.tiles[1] }, pressed && { transform: [{ scale: 0.98 }] }]}
          onPress={() => router.push({ pathname: '/quiz', params: { kind: 'sound' } })}
          accessibilityRole="button"
          accessibilityLabel="Start sound quiz, 10 questions"
        >
          <View style={{ flex: 1, gap: space.s }}>
            <Text style={[styles.cardTitle, { color: c.ink }]}>Sound quiz</Text>
            <Text style={[styles.cardBody, { color: c.inkMuted }]}>Listen, read the spectrogram, name the singer. Local birds first</Text>
            <View style={[styles.start, { backgroundColor: c.primary }]}>
              <Text style={[styles.startText, { color: c.onPrimary }]}>Start</Text>
              <Feather name="arrow-right" size={16} color={c.onPrimary} />
            </View>
          </View>
          <Feather name="music" size={64} color={c.tintIcon} />
        </Pressable>

        <QuizScopes signedIn={!!session} />


        <Pressable style={styles.progressHead} onPress={() => router.push('/progress')} accessibilityRole="button">
          <Text style={[styles.h2, { color: c.ink }]}>Your progress</Text>
          <Text style={[styles.seeAll, { color: c.accentDeep }]}>See all ›</Text>
        </Pressable>
        <View style={styles.stats}>
          <Stat label="Quizzes" value={stats.quizzes} />
          <Stat label="Accuracy" value={`${accuracy(stats)}%`} />
          <Stat label="Best streak" value={stats.bestStreak} />
        </View>
        {Object.keys(stats.missed).length > 0 && (
          <Text style={[styles.cardBody, { color: c.inkMuted }]}>
            {Object.keys(stats.missed).length} birds to practise again
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { borderColor: c.border }]}>
      <Text style={[styles.statLabel, { color: c.inkMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: c.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  progressHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  seeAll: { fontFamily: font.semibold, fontSize: 14 },
  cards: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderRadius: radius.card, padding: space.l },
  cardsIcon: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  cardsTitle: { fontFamily: font.display, fontSize: 20 },
  dueBadge: { minWidth: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  dueText: { fontFamily: font.bold, fontSize: 14 },
  bleed: { marginHorizontal: -space.screen, paddingHorizontal: space.screen },
  lesson: { width: 180, height: 210, borderRadius: radius.card, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: '#3B2F9E' },
  lessonTitle: { fontFamily: font.display, fontSize: 19, lineHeight: 22, color: '#FFFFFF' },
  lessonSub: { fontFamily: font.semibold, fontSize: 12, color: '#E3E0FF', marginTop: 2 },
  done: { position: 'absolute', top: space.s, right: space.s, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  doneText: { fontFamily: font.bold, fontSize: 11 },
  content: { paddingHorizontal: space.screen, paddingBottom: space.xxl * 2, gap: space.l },
  hero: { fontFamily: font.display, fontSize: 36, lineHeight: 38, marginTop: space.s },
  lead: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  featured: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.card, padding: space.xl, gap: space.l },
  kicker: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1.2, color: '#C9C2FF' },
  card: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.card, padding: space.xl, gap: space.l },
  cardTitle: { fontFamily: font.display, fontSize: 24 },
  cardBody: { fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
  start: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: space.l,
    height: 40,
    marginTop: space.s,
  },
  startText: { fontFamily: font.semibold, fontSize: 14 },
  soon: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderWidth: 1.5, borderRadius: radius.card, padding: space.l },
  h2: { fontFamily: font.bold, fontSize: 18, marginTop: space.m },
  stats: { flexDirection: 'row', gap: space.s },
  stat: { flex: 1, borderWidth: 1.5, borderRadius: radius.tile, paddingVertical: space.m, alignItems: 'center', gap: 2 },
  statLabel: { fontFamily: font.medium, fontSize: 12 },
  statValue: { fontFamily: font.display, fontSize: 22 },
});
