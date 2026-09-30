import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/components/Pressable';

import { font, space, useColors } from '@/theme';

const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HEIGHT = 72;

/** Records per month as 12 thin bars (single series, so no legend); the current month is marked; tap a bar for its count. */
export function MonthChart({ months }: { months: number[] }) {
  const now = new Date().getMonth();
  const c = useColors();
  const [picked, setPicked] = useState<number | null>(null);
  const top = Math.max(...months, 1);
  const busiest = months.indexOf(Math.max(...months));
  const shown = picked ?? now;

  return (
    <View
      accessible
      accessibilityLabel={`Records by month: ${months.map((n, i) => `${NAMES[i]} ${n}`).join(', ')}`}
    >
      <Text style={[styles.readout, { color: c.ink }]}>
        {NAMES[shown]} · {months[shown]} {months[shown] === 1 ? 'record' : 'records'}
        {shown === now ? ' (this month)' : shown === busiest ? ' (busiest month)' : ''}
      </Text>
      <View style={[styles.plot, { borderBottomColor: c.border }]}>
        {months.map((n, i) => (
          <Pressable key={i} style={styles.slot} onPress={() => setPicked(i === picked ? null : i)} hitSlop={4}>
            <View
              style={[
                styles.bar,
                {
                  height: n ? Math.max(3, (n / top) * HEIGHT) : 0,
                  backgroundColor: i === shown ? c.accentDeep : c.accent,
                },
              ]}
            />
          </Pressable>
        ))}
      </View>
      <View style={styles.axis}>
        {NAMES.map((m, i) => (
          <Text key={m} style={[styles.tick, { color: i === now ? c.ink : c.inkFaint }, i === now && { fontFamily: font.bold }]}>
            {m[0]}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { fontFamily: font.semibold, fontSize: 13, marginBottom: space.s },
  plot: { height: HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: 2, borderBottomWidth: 1 },
  slot: { flex: 1, height: HEIGHT, justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  axis: { flexDirection: 'row', gap: 2, marginTop: 4 },
  tick: { flex: 1, textAlign: 'center', fontFamily: font.medium, fontSize: 11 },
});
