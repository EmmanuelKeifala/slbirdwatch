import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mediaUrl, spotGame, type SpotRound } from '@/api';
import { close } from '@/nav';
import { Pressable } from '@/Pressable';
import { font, radius, space, useColors } from '@/theme';
import { answerFeel } from '@/haptics';

/** QZ-07 "Spot the difference": two lookalikes side by side; tap the named one, then learn how to tell them apart. */
export default function Spot() {
  const c = useColors();
  const [rounds, setRounds] = useState<SpotRound[] | null>(null);
  const [error, setError] = useState(false);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [game, setGame] = useState(0);

  useEffect(() => {
    spotGame().then(
      (r) => setRounds(r.rounds),
      () => setError(true),
    );
  }, [game]);

  const again = () => {
    setRounds(null);
    setI(0);
    setPicked(null);
    setScore(0);
    setGame(game + 1);
  };

  if (error || (rounds && rounds.length === 0)) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}>
        <Text style={[styles.body, { color: c.inkMuted, textAlign: 'center' }]}>
          {error ? 'Couldn’t load the game. Check your connection.' : 'No lookalike pairs with photos yet.'}
        </Text>
        <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={close} accessibilityRole="button">
          <Text style={[styles.primaryText, { color: c.onPrimary }]}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  if (!rounds) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.accent} />
      </SafeAreaView>
    );
  }
  if (i >= rounds.length) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}>
        <Text style={[styles.big, { color: c.ink }]}>
          {score} / {rounds.length}
        </Text>
        <Text style={[styles.body, { color: c.inkMuted, textAlign: 'center' }]}>
          {score === rounds.length ? 'A sharp eye for detail!' : 'Lookalikes are hard. Each tip you read makes the next one easier.'}
        </Text>
        <Pressable style={[styles.primary, { backgroundColor: c.primary }]} onPress={again} accessibilityRole="button">
          <Text style={[styles.primaryText, { color: c.onPrimary }]}>Play again</Text>
        </Pressable>
        <Pressable onPress={close} accessibilityRole="button">
          <Text style={[styles.link, { color: c.inkMuted }]}>Done</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const r = rounds[i];
  const answered = picked !== null;
  const right = picked === r.target.id;
  const other = r.birds.find((b) => b.id !== r.target.id)!;
  const choose = (id: number) => {
    if (answered) return;
    setPicked(id);
    answerFeel(id === r.target.id);
    if (id === r.target.id) setScore(score + 1);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={styles.top}>
        <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Quit">
          <Feather name="x" size={24} color={c.ink} />
        </Pressable>
        <Text style={[styles.kicker, { color: c.accentDeep }]}>SPOT THE DIFFERENCE</Text>
        <Text style={[styles.count, { color: c.inkMuted }]}>
          {i + 1}/{rounds.length}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.question, { color: c.ink }]}>Which one is the {r.target.english_name}?</Text>
        <Text style={[styles.body, { color: c.inkMuted }]}>The other is a close relative. Look at bill, markings and colour.</Text>
        <View style={styles.pair}>
          {r.birds.map((b) => {
            const isTarget = b.id === r.target.id;
            const border = !answered ? c.border : isTarget ? c.correct : b.id === picked ? c.wrong : c.border;
            return (
              <Pressable
                key={b.id}
                style={[styles.card, { borderColor: border }]}
                onPress={() => choose(b.id)}
                disabled={answered}
                accessibilityRole="button"
                accessibilityLabel={answered ? b.english_name : `Photo ${r.birds.indexOf(b) + 1}`}
              >
                <Image source={{ uri: mediaUrl(b.photo) }} style={styles.photo} contentFit="cover" />
                {answered && (
                  <View style={{ padding: space.s, gap: 2 }}>
                    <Text style={[styles.name, { color: c.ink }]} numberOfLines={2}>
                      {isTarget && <Feather name="check" size={14} color={c.correct} />} {b.english_name}
                    </Text>
                    {!!b.length && <Text style={[styles.small, { color: c.inkMuted }]}>{b.length}</Text>}
                    <Text style={[styles.small, { color: c.inkFaint }]} numberOfLines={1}>
                      {b.credit}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {answered && (
          <View style={[styles.explain, { backgroundColor: c.tiles[right ? 1 : 2] }]} accessibilityLiveRegion="polite">
            <Text style={[styles.verdict, { color: right ? c.correct : c.wrong }]}>{right ? 'Well spotted!' : 'Not this time'}</Text>
            <Text style={[styles.body, { color: c.ink }]}>
              {r.tip ||
                (r.target.length && other.length
                  ? `Size helps: the ${r.target.english_name} is ${r.target.length}, the ${other.english_name} ${other.length}.`
                  : `Both are in the same genus, so the differences are small. Compare them side by side to learn the marks.`)}
            </Text>
            {!!r.tip && <Text style={[styles.small, { color: c.inkMuted }]}>Tip from an expert</Text>}
            <Pressable
              onPress={() => router.push({ pathname: '/compare', params: { ids: `${r.target.id},${other.id}` } })}
              accessibilityRole="link"
            >
              <Text style={[styles.link, { color: c.accentDeep, textAlign: 'left' }]}>Compare them side by side</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      {answered && (
        <View style={styles.bottom}>
          <Pressable
            style={[styles.primary, { backgroundColor: c.primary, alignSelf: 'stretch' }]}
            onPress={() => {
              setI(i + 1);
              setPicked(null);
            }}
            accessibilityRole="button"
          >
            <Text style={[styles.primaryText, { color: c.onPrimary }]}>{i + 1 < rounds.length ? 'Next pair' : 'See score'}</Text>
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
  count: { fontFamily: font.semibold, fontSize: 13 },
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 3 },
  question: { fontFamily: font.display, fontSize: 26, lineHeight: 30 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  pair: { flexDirection: 'row', gap: space.m },
  card: { flex: 1, borderWidth: 2.5, borderRadius: radius.card, overflow: 'hidden' },
  photo: { width: '100%', aspectRatio: 0.8 },
  name: { fontFamily: font.bold, fontSize: 14 },
  small: { fontFamily: font.medium, fontSize: 11 },
  explain: { borderRadius: radius.card, padding: space.l, gap: space.s },
  verdict: { fontFamily: font.display, fontSize: 20 },
  link: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center', marginTop: space.s },
  bottom: { position: 'absolute', left: space.screen, right: space.screen, bottom: space.xl },
  primary: { height: 52, borderRadius: radius.pill, paddingHorizontal: space.xxl, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: font.semibold, fontSize: 15 },
  big: { fontFamily: font.display, fontSize: 56 },
});
