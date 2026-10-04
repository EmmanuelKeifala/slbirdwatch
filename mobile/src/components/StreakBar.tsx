import { FontAwesome } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { streakGoal } from '@/lib/goals';
import { font, radius, space, useColors } from '@/theme';

/**
 * The daily streak as progress to its next milestone (3, 7, 14, 30 days…): a near target to close in on
 * rather than a bare count. `lit` = today's round is played, so the streak is safe. `light` for dark cards.
 * The snowflake count is the streak freezes held: a missed day uses one instead of ending the streak.
 */
export function StreakBar({
  days,
  lit = true,
  light,
  freezes,
}: {
  days: number;
  lit?: boolean;
  light?: boolean;
  /** Streak freezes held, shown as a snowflake count. */
  freezes?: number;
}) {
  const c = useColors();
  const { from, to } = streakGoal(days);
  const ink = light ? '#FFFFFF' : c.ink;
  const muted = light ? 'rgba(255,255,255,0.75)' : c.inkMuted;
  const left = to - days;
  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityLabel={`${days}-day streak. ${left} more to reach ${to} days.${
        freezes === undefined ? '' : ` ${freezes} streak freeze${freezes === 1 ? '' : 's'} held.`
      }`}
    >
      <View style={styles.row}>
        <FontAwesome name="fire" size={16} color={lit ? '#FF9F1C' : muted} />
        <Text style={[styles.name, { color: ink }]}>
          {days}-day streak
        </Text>
        <Text style={[styles.num, { color: muted }]}>
          {left} to go to {to}
        </Text>
        {freezes !== undefined && (
          <View style={[styles.freeze, { backgroundColor: light ? 'rgba(255,255,255,0.18)' : c.tiles[4] }]}>
            <FontAwesome name="snowflake-o" size={11} color={freezes ? (light ? '#BFE3FF' : '#2B7FC2') : muted} />
            <Text style={[styles.num, { color: freezes ? ink : muted }]}>{freezes}</Text>
          </View>
        )}
      </View>
      <View style={[styles.track, { backgroundColor: light ? 'rgba(255,255,255,0.22)' : c.tiles[3] }]}>
        <View style={[styles.fill, { backgroundColor: '#FF9F1C', width: `${(100 * (days - from)) / (to - from)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  name: { flex: 1, fontFamily: font.bold, fontSize: 15 },
  num: { fontFamily: font.medium, fontSize: 12 },
  freeze: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: 8, height: 22 },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
});
