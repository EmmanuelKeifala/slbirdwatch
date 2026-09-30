import { Feather } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/components/Pressable';

import { close } from '@/lib/nav';
import { font, space, useColors } from '@/theme';

/** Back chevron · centred title (+ count badge) · optional right action — design/refs/screen-*.png. */
export function ScreenHeader({ title, badge, back, right }: { title: string; badge?: number; back?: boolean; right?: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {back && (
          <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Feather name="chevron-left" size={26} color={c.ink} />
          </Pressable>
        )}
      </View>
      <View style={styles.middle}>
        <Text style={[styles.title, { color: c.ink }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {badge !== undefined && (
          <View style={[styles.badge, { backgroundColor: c.accentDeep }]}>
            <Text style={[styles.badgeText, { color: c.onAccent }]}>{badge.toLocaleString()}</Text>
          </View>
        )}
      </View>
      <View style={[styles.side, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.screen, height: 56 },
  side: { width: 40 },
  middle: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s },
  title: { fontFamily: font.bold, fontSize: 16 },
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontFamily: font.bold, fontSize: 12 },
});
