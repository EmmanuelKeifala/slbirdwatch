import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mediaUrl, speciesCards, type FlashcardData } from '@/api';
import { BirdArt } from '@/components/BirdArt';
import { gradeCard, loadDeck } from '@/state/deck';
import { Mnemonic } from '@/components/Mnemonic';
import { Pressable } from '@/components/Pressable';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SoundPlayer } from '@/components/SoundPlayer';
import { dueCards, nextLabel, type Card, type Grade } from '@/lib/srs';
import { font, radius, space, tileFor, useColors } from '@/theme';

const GRADES: { g: Grade; label: string; tone: 'wrong' | 'rare' | 'accent' | 'correct' }[] = [
  { g: 'again', label: 'Again', tone: 'wrong' },
  { g: 'hard', label: 'Hard', tone: 'rare' },
  { g: 'good', label: 'Good', tone: 'accent' },
  { g: 'easy', label: 'Easy', tone: 'correct' },
];

/** LRN-04: review the birds that are due — photo first, then the name, then how well you knew it. */
export default function Flashcards() {
  const c = useColors();
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [data, setData] = useState<Record<number, FlashcardData>>({});
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [now, setNow] = useState(() => Date.now()); // the clock, read in handlers only

  useFocusEffect(
    useCallback(() => {
      const t = Date.now();
      setNow(t);
      const due = dueCards(loadDeck(), t).slice(0, 20);
      setQueue(due);
      if (due.length)
        speciesCards(due.map((d) => d.speciesId)).then(
          (r) => setData(Object.fromEntries(r.items.map((i) => [i.id, i]))),
          () => {},
        );
    }, []),
  );

  const card = queue?.[0];
  const bird = card ? data[card.speciesId] : undefined;
  const grade = (g: Grade) => {
    if (!card) return;
    setNow(gradeCard(card.speciesId, g));
    setShown(false);
    setDone(done + 1);
    // "Again" comes back later in this session; the others leave the queue.
    setQueue(g === 'again' ? [...queue!.slice(1), { ...card }] : queue!.slice(1));
  };
  const deckSize = loadDeck().length;
  const nextDue = loadDeck()
    .map((d) => d.due)
    .filter((d) => d > now)
    .sort((a, b) => a - b)[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Flashcards" back />
      {queue === null ? (
        <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
      ) : !card ? (
        <View style={styles.center}>
          <BirdArt id={9} size={150} />
          <Text style={[styles.big, { color: c.ink }]}>{done ? 'All done for now' : 'Nothing due'}</Text>
          <Text style={[styles.body, { color: c.inkMuted, textAlign: 'center' }]}>
            {deckSize === 0
              ? 'Birds you miss in quizzes land here, and you can add any bird from its page.'
              : nextDue
                ? `${deckSize} birds in your deck. Next one is due ${new Date(nextDue).toLocaleDateString(undefined, { weekday: 'long' })}.`
                : `${deckSize} birds in your deck.`}
          </Text>
          <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={() => router.back()} accessibilityRole="button">
            <Text style={[styles.primaryText, { color: c.onPrimary }]}>Back to Learn</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.count, { color: c.inkMuted }]}>
            {queue.length} to go{done ? ` · ${done} reviewed` : ''}
          </Text>
          <View style={[styles.photo, { backgroundColor: tileFor(c, card.speciesId) }]}>
            {bird?.image ? (
              <Image source={{ uri: mediaUrl(bird.image) }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <BirdArt id={card.speciesId} size={200} />
            )}
          </View>
          {bird?.sound && <SoundPlayer sound={bird.sound} />}
          {shown && !!bird?.mnemonic && <Mnemonic speciesId={bird.id} name={bird.english_name} text={bird.mnemonic} />}

          {!shown ? (
            <Pressable style={[styles.reveal, { borderColor: c.primary }]} onPress={() => setShown(true)} accessibilityRole="button">
              <Text style={[styles.revealText, { color: c.ink }]}>Who is this? Tap to see</Text>
            </Pressable>
          ) : (
            <>
              <Text style={[styles.big, { color: c.ink }]}>{bird?.english_name ?? '…'}</Text>
              <Text style={[styles.sci, { color: c.inkMuted }]}>{bird?.scientific_name}</Text>
              {!!bird?.tip && <Text style={[styles.body, { color: c.ink }]}>{bird.tip}</Text>}
              <Text style={[styles.count, { color: c.inkMuted, marginTop: space.m }]}>How well did you know it?</Text>
              <View style={styles.grades}>
                {GRADES.map(({ g, label, tone }) => {
                  const color = tone === 'accent' ? c.accent : c[tone];
                  return (
                    <Pressable
                      key={g}
                      style={[styles.grade, { borderColor: color }]}
                      onPress={() => grade(g)}
                      accessibilityRole="button"
                      accessibilityLabel={`${label}, next in ${nextLabel(card, g, now)}`}
                    >
                      <Text style={[styles.gradeText, { color }]}>{label}</Text>
                      <Text style={[styles.gradeNext, { color: c.inkMuted }]}>{nextLabel(card, g, now)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable onPress={() => router.push(`/species/${card.speciesId}`)} accessibilityRole="link">
                <Text style={[styles.link, { color: c.accentDeep }]}>
                  <Feather name="info" size={13} /> More about this bird
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.m },
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
  count: { fontFamily: font.semibold, fontSize: 13 },
  photo: { height: 300, borderRadius: 28, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  reveal: { borderWidth: 2, borderStyle: 'dashed', borderRadius: radius.card, height: 64, alignItems: 'center', justifyContent: 'center' },
  revealText: { fontFamily: font.bold, fontSize: 16 },
  big: { fontFamily: font.display, fontSize: 30, lineHeight: 34, textAlign: 'center' },
  sci: { fontFamily: font.italic, fontSize: 14, textAlign: 'center', marginTop: -6 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  grades: { flexDirection: 'row', gap: space.s },
  grade: { flex: 1, borderWidth: 2, borderRadius: radius.tile, paddingVertical: space.m, alignItems: 'center', gap: 2 },
  gradeText: { fontFamily: font.bold, fontSize: 15 },
  gradeNext: { fontFamily: font.medium, fontSize: 11 },
  link: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center', marginTop: space.s },
  primary: { borderRadius: radius.pill, height: 52, paddingHorizontal: space.xxl, justifyContent: 'center', marginTop: space.m },
  primaryText: { fontFamily: font.semibold, fontSize: 15 },
});
