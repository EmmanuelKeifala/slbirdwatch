import { FontAwesome } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { font, radius, space, useColors } from '@/theme';

/** "4 in a row" under the game bar once a run of right answers reaches three; it pops again as the run grows. */
export function Combo({ n }: { n: number }) {
  const c = useColors();
  if (n < 3) return null;
  return (
    // a zero-height row right under the bar, so the pill floats over the content without moving it
    <View style={styles.anchor} pointerEvents="none">
      <Animated.View key={n} entering={ZoomIn.springify().damping(10)} style={[styles.pill, { backgroundColor: c.tiles[3] }]}>
        <FontAwesome name="fire" size={13} color="#E8590C" />
        <Text style={[styles.text, { color: c.ink }]} accessibilityLiveRegion="polite">
          {n} in a row
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { height: 0, alignItems: 'center', zIndex: 1 },
  pill: {
    position: 'absolute',
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: space.m,
    borderRadius: radius.pill,
  },
  text: { fontFamily: font.bold, fontSize: 13 },
});
