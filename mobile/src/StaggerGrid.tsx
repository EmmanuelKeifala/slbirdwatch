import { useMemo, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { space, useColors } from '@/theme';

/**
 * Two-column staggered grid from design/refs/screen-discoveries.png.
 * `leadRight` (e.g. the + tile) sits at the top of the right column; cards alternate tall/short.
 * `collapsible` floats above the list and tucks away while scrolling down, sliding back in on the way up
 * (and always at the top), so the list gets the room. Plain RN Animated on the native driver (works in Expo Go).
 */
export function StaggerGrid<T>({
  items,
  keyOf,
  render,
  leadRight,
  header,
  collapsible,
  footer,
  onEndReached,
}: {
  items: T[];
  keyOf: (item: T) => string | number;
  render: (item: T, tall: boolean) => ReactNode;
  leadRight?: ReactNode;
  header?: ReactNode;
  collapsible?: ReactNode;
  footer?: ReactNode;
  onEndReached?: () => void;
}) {
  const c = useColors();
  const left = items.filter((_, i) => i % 2 === 0);
  const right = items.filter((_, i) => i % 2 === 1);
  const [height, setHeight] = useState(0);
  const [scrollY] = useState(() => new Animated.Value(0));
  // diffClamp follows the finger: down hides up to the header's height, up brings it back; bounce at the top
  // (negative offsets) is clamped away so the header never jumps.
  const translateY = useMemo(
    () =>
      Animated.diffClamp(
        scrollY.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' }),
        0,
        Math.max(1, height),
      ).interpolate({
        inputRange: [0, Math.max(1, height)],
        outputRange: [0, -Math.max(1, height)],
      }),
    [scrollY, height],
  );
  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: (e: {
          nativeEvent: { layoutMeasurement: { height: number }; contentOffset: { y: number }; contentSize: { height: number } };
        }) => {
          const n = e.nativeEvent;
          if (n.layoutMeasurement.height + n.contentOffset.y > n.contentSize.height - 500) onEndReached?.();
        },
      }),
    [scrollY, onEndReached],
  );

  return (
    <View style={{ flex: 1 }}>
      <Animated.ScrollView
        contentContainerStyle={[styles.content, { paddingTop: collapsible ? height : 0 }]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={onScroll}
      >
        {header}
        <View style={styles.row}>
          <View style={styles.column}>
            {left.map((item, i) => (
              <View key={keyOf(item)}>{render(item, i % 2 === 0)}</View>
            ))}
          </View>
          <View style={styles.column}>
            {leadRight}
            {right.map((item, i) => (
              <View key={keyOf(item)}>{render(item, i % 2 === 1)}</View>
            ))}
          </View>
        </View>
        {footer}
      </Animated.ScrollView>
      {collapsible && (
        <Animated.View
          style={[styles.float, { backgroundColor: c.bg, transform: [{ translateY }] }]}
          onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
        >
          {collapsible}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.screen, paddingBottom: 120 },
  row: { flexDirection: 'row', gap: 14 },
  column: { flex: 1, gap: 14 },
  float: { position: 'absolute', top: 0, left: 0, right: 0 },
});
