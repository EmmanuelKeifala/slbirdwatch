import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { bestScores } from '@/gameScores';
import { Pressable } from '@/Pressable';
import { font, radius, space, useColors } from '@/theme';

type Icon = ComponentProps<typeof Feather>['name'];

/** QZ-07/08/09/10: the quick games, as a 2-column grid on the Games tab. */
export function Games() {
  const c = useColors();
  const [best, setBest] = useState(bestScores);
  useFocusEffect(useCallback(() => setBest(bestScores()), []));
  const games: { path: '/spot' | '/speed' | '/reveal' | '/chorus'; icon: Icon; title: string; text: string; tile: string }[] = [
    { path: '/spot', icon: 'columns', title: 'Spot the difference', text: 'Two lookalikes: which is which?', tile: c.tiles[0] },
    {
      path: '/speed',
      icon: 'zap',
      title: 'Speed round',
      text: best.speed ? `60 seconds · best ${best.speed}` : '60 seconds, as many as you can',
      tile: c.tiles[3],
    },
    {
      path: '/reveal',
      icon: 'eye',
      title: 'Reveal',
      text: best.reveal ? `Name it from a close-up · best ${best.reveal}` : 'Name it from a close-up',
      tile: c.tiles[4],
    },
    { path: '/chorus', icon: 'sunrise', title: 'Dawn chorus', text: 'Several birds at once: name them all', tile: c.tiles[1] },
  ];
  return (
    <View style={{ gap: space.m }}>
      <Text style={[styles.h2, { color: c.ink }]}>Play</Text>
      <View style={styles.grid}>
        {games.map((g) => (
          <Pressable
            key={g.path}
            style={[styles.card, { backgroundColor: g.tile }]}
            onPress={() => router.push(g.path)}
            accessibilityRole="button"
          >
            <View style={[styles.icon, { backgroundColor: c.bg }]}>
              <Feather name={g.icon} size={20} color={c.accentDeep} />
            </View>
            <Text style={[styles.title, { color: c.ink }]}>{g.title}</Text>
            <Text style={[styles.text, { color: c.inkMuted }]}>{g.text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  h2: { fontFamily: font.display, fontSize: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m },
  card: { width: '47.5%', flexGrow: 1, minHeight: 150, borderRadius: radius.card, padding: space.m, gap: 6 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { fontFamily: font.bold, fontSize: 15 },
  text: { fontFamily: font.medium, fontSize: 12, lineHeight: 16 },
});
