import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Mnemonic } from '@/Mnemonic';
import { getLesson, mediaUrl, type LessonBird } from '@/api';
import { BirdArt } from '@/BirdArt';
import { Pressable } from '@/Pressable';
import { ScreenHeader } from '@/ScreenHeader';
import { SoundPlayer } from '@/SoundPlayer';
import { font, radius, space, tileFor, useColors } from '@/theme';

type Lesson = { slug: string; title: string; blurb: string; birds: LessonBird[] };
type Page = { kind: 'intro' } | { kind: 'bird'; bird: LessonBird; n: number } | { kind: 'test' };

/** LRN-02: swipe through a lesson — intro, one page per bird, then a quiz on just these birds. */
export default function LessonScreen() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [page, setPage] = useState(0);
  const list = useRef<FlatList<Page>>(null);

  useEffect(() => {
    getLesson(slug).then(setLesson, () => {});
  }, [slug]);

  if (!lesson) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <ScreenHeader title="Lesson" back />
        <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
      </SafeAreaView>
    );
  }
  const pages: Page[] = [{ kind: 'intro' }, ...lesson.birds.map((bird, n) => ({ kind: 'bird' as const, bird, n })), { kind: 'test' }];
  const go = (i: number) => list.current?.scrollToIndex({ index: Math.max(0, Math.min(pages.length - 1, i)) });
  const startQuiz = () =>
    router.push({ pathname: '/quiz', params: { species: lesson.birds.map((b) => b.id).join(','), lesson: lesson.slug } });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title={lesson.title} back />
      <View style={styles.progress}>
        {pages.map((_, i) => (
          <View key={i} style={[styles.dash, { backgroundColor: i <= page ? c.accent : c.border }]} />
        ))}
      </View>
      <FlatList
        ref={list}
        data={pages}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <ScrollView style={{ width }} contentContainerStyle={styles.page}>
            {item.kind === 'intro' ? (
              <>
                <Text style={[styles.kicker, { color: c.accentDeep }]}>LESSON · {lesson.birds.length} BIRDS</Text>
                <Text style={[styles.big, { color: c.ink }]}>{lesson.title}</Text>
                <Text style={[styles.body, { color: c.inkMuted }]}>{lesson.blurb}</Text>
                <Text style={[styles.body, { color: c.inkMuted }]}>
                  Swipe through each bird: look at it, read how to tell it apart, listen to it. Then test yourself.
                </Text>
                <View style={styles.names}>
                  {lesson.birds.map((b) => (
                    <View key={b.id} style={[styles.name, { backgroundColor: c.field }]}>
                      <Text style={[styles.nameText, { color: c.ink }]}>{b.english_name}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : item.kind === 'bird' ? (
              <>
                <View style={[styles.photo, { backgroundColor: tileFor(c, item.bird.id) }]}>
                  {item.bird.image ? (
                    <Image source={{ uri: mediaUrl(item.bird.image) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  ) : (
                    <BirdArt id={item.bird.id} size={200} />
                  )}
                </View>
                <Text style={[styles.kicker, { color: c.accentDeep }]}>
                  BIRD {item.n + 1} OF {lesson.birds.length}
                </Text>
                <Text style={[styles.big, { color: c.ink }]}>{item.bird.english_name}</Text>
                <Text style={[styles.sci, { color: c.inkMuted }]}>
                  {item.bird.scientific_name}
                  {item.bird.length ? ` · ${item.bird.length}` : ''}
                </Text>
                {!!item.bird.sexes && <Tip icon="users" title="Males and females" text={item.bird.sexes} />}
                {!!item.bird.voice && <Tip icon="music" title="Voice" text={item.bird.voice} />}
                {item.bird.sound && <SoundPlayer sound={item.bird.sound} caption={`${item.bird.sound.credit} · ${item.bird.sound.licence}`} />}
                {!!item.bird.mnemonic && <Mnemonic speciesId={item.bird.id} name={item.bird.english_name} text={item.bird.mnemonic} />}
                <Pressable onPress={() => router.push(`/species/${item.bird.id}`)} accessibilityRole="link">
                  <Text style={[styles.link, { color: c.accentDeep }]}>Everything about this bird ›</Text>
                </Pressable>
              </>
            ) : (
              <LinearGradient colors={[c.night[0], c.night[1], c.night[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.test}>
                <Text style={styles.testKicker}>TEST YOURSELF</Text>
                <Text style={styles.testTitle}>Can you name all {lesson.birds.length}?</Text>
                <Text style={styles.testBody}>A quick quiz on just these birds. Score 70% to complete the lesson.</Text>
                <Pressable style={styles.testButton} onPress={startQuiz} accessibilityRole="button">
                  <Text style={[styles.testButtonText, { color: c.ink }]}>Start the quiz</Text>
                  <Feather name="arrow-right" size={16} color={c.ink} />
                </Pressable>
              </LinearGradient>
            )}
          </ScrollView>
        )}
      />
      <View style={styles.nav}>
        <Pressable onPress={() => go(page - 1)} disabled={page === 0} style={[styles.navBtn, { borderColor: c.border }, page === 0 && { opacity: 0.3 }]}>
          <Feather name="chevron-left" size={20} color={c.ink} />
        </Pressable>
        <Pressable
          onPress={() => (page === pages.length - 1 ? startQuiz() : go(page + 1))}
          style={[styles.next, { backgroundColor: c.primary }]}
          accessibilityRole="button"
        >
          <Text style={[styles.nextText, { color: c.onPrimary }]}>{page === 0 ? 'Start' : page === pages.length - 1 ? 'Take the quiz' : 'Next bird'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Tip({ icon, title, text }: { icon: React.ComponentProps<typeof Feather>['name']; title: string; text: string }) {
  const c = useColors();
  return (
    <View style={[styles.tip, { backgroundColor: c.field }]}>
      <View style={styles.tipHead}>
        <Feather name={icon} size={14} color={c.tintIcon} />
        <Text style={[styles.tipTitle, { color: c.ink }]}>{title}</Text>
      </View>
      <Text style={[styles.body, { color: c.ink }]} numberOfLines={8}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 4, paddingHorizontal: space.screen, marginBottom: space.s },
  dash: { flex: 1, height: 4, borderRadius: 2 },
  page: { padding: space.screen, gap: space.m, paddingBottom: space.xxl },
  kicker: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1.2, marginTop: space.s },
  big: { fontFamily: font.display, fontSize: 32, lineHeight: 36 },
  sci: { fontFamily: font.italic, fontSize: 14, marginTop: -6 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 23 },
  names: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
  name: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 6 },
  nameText: { fontFamily: font.semibold, fontSize: 13 },
  photo: { height: 260, borderRadius: 28, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  tip: { borderRadius: radius.tile, padding: space.l, gap: 6 },
  tipHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tipTitle: { fontFamily: font.bold, fontSize: 14 },
  link: { fontFamily: font.semibold, fontSize: 14, marginTop: space.s },
  test: { borderRadius: 28, padding: space.xl, gap: space.m, marginTop: space.xl },
  testKicker: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1.2, color: '#C9C2FF' },
  testTitle: { fontFamily: font.display, fontSize: 30, lineHeight: 34, color: '#FFFFFF' },
  testBody: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: '#E3E0FF' },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.pill,
    paddingHorizontal: space.l,
    height: 46,
  },
  testButtonText: { fontFamily: font.semibold, fontSize: 15 },
  nav: { flexDirection: 'row', gap: space.m, padding: space.screen, paddingTop: space.s },
  navBtn: { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  next: { flex: 1, height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  nextText: { fontFamily: font.semibold, fontSize: 16 },
});
