import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import type { XP } from '@/api';
import { font, radius, useColors } from '@/theme';

/**
 * Level name, a bar of the way to the next level, and how far there is to go. With `gained`, the bar starts
 * where the player stood before this round and fills to where they are now. `light` is for dark backgrounds.
 */
export function LevelBar({ xp, gained = 0, light }: { xp: XP; gained?: number; light?: boolean }) {
  const c = useColors();
  const span = (xp.next_at ?? xp.xp) - xp.level_at || 1;
  const at = (v: number) => Math.min(1, Math.max(0, (v - xp.level_at) / span));
  const now = xp.next_at === null ? 1 : at(xp.xp);
  const fill = useSharedValue(at(xp.xp - gained));
  useEffect(() => {
    fill.value = withDelay(500, withTiming(now, { duration: 900 }));
  }, [fill, now]);
  const style = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  const ink = light ? '#FFFFFF' : c.ink;
  const muted = light ? 'rgba(255,255,255,0.75)' : c.inkMuted;
  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityLabel={`Level ${xp.level}, ${xp.level_name}. ${xp.xp} XP${xp.next_at ? `, ${xp.next_at - xp.xp} to the next level` : ''}`}
    >
      <View style={styles.row}>
        <Text style={[styles.name, { color: ink }]}>
          Level {xp.level} · {xp.level_name}
        </Text>
        <Text style={[styles.num, { color: muted }]}>{xp.xp} XP</Text>
      </View>
      <View style={[styles.track, { backgroundColor: light ? 'rgba(255,255,255,0.22)' : c.tint }]}>
        <Animated.View style={[styles.fill, { backgroundColor: light ? '#FFFFFF' : c.accent }, style]} />
      </View>
      <Text style={[styles.num, { color: muted }]}>
        {xp.next_at ? `${xp.next_at - xp.xp} XP to level ${xp.level + 1}` : 'Top level reached'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  name: { fontFamily: font.bold, fontSize: 15 },
  num: { fontFamily: font.medium, fontSize: 12 },
  track: { height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 10, borderRadius: radius.pill },
});
