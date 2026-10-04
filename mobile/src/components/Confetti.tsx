import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { useColors } from '@/theme';

const PIECES = 36;

/** One burst of paper falling down the screen, for the big moments (perfect round, new best, level up). */
export function Confetti() {
  const c = useColors();
  const { width, height } = useWindowDimensions();
  const colours = [c.accent, c.rare, c.correct, c.night[3], c.accentDeep];
  // random once per burst, not per render
  const [pieces] = useState(() =>
    Array.from({ length: PIECES }, (_, i) => ({
      x: Math.random() * width,
      drift: (Math.random() - 0.5) * 120,
      spin: (Math.random() - 0.5) * 1080,
      delay: Math.random() * 500,
      time: 1800 + Math.random() * 1400,
      size: 6 + Math.random() * 6,
      colour: colours[i % colours.length],
    })),
  );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {pieces.map((p, i) => (
        <Piece key={i} {...p} fall={height + 40} />
      ))}
    </View>
  );
}

function Piece({
  x,
  drift,
  spin,
  delay,
  time,
  size,
  colour,
  fall,
}: {
  x: number;
  drift: number;
  spin: number;
  delay: number;
  time: number;
  size: number;
  colour: string;
  fall: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withTiming(1, { duration: time, easing: Easing.in(Easing.quad) }));
  }, [t, delay, time]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value > 0.85 ? (1 - t.value) / 0.15 : 1,
    transform: [{ translateX: x + drift * t.value }, { translateY: -20 + fall * t.value }, { rotate: `${spin * t.value}deg` }],
  }));
  return <Animated.View style={[styles.piece, { width: size, height: size * 1.6, backgroundColor: colour }, style]} />;
}

const styles = StyleSheet.create({ piece: { position: 'absolute', top: 0, left: 0, borderRadius: 2 } });
