import { useMemo, useState, type ReactNode } from 'react';
import { Animated, FlatList, RefreshControl, StyleSheet, View, type ListRenderItem } from 'react-native';

// Animated.FlatList's types can't carry a generic item; it is the same component at runtime.
const AnimatedList = Animated.FlatList as unknown as typeof FlatList;

import { space, useColors } from '@/theme';

/**
 * Two-column staggered grid from design/refs/screen-discoveries.png; cards alternate tall/short.
 * Cards go in blocks of four (left: tall, short · right: short, tall), so both columns end level in every block
 * and the blocks can be a virtualized FlatList: long lists only render what's on screen.
 * `collapsible` floats above the list and tucks away while scrolling down, sliding back in on the way up
 * (and always at the top), so the list gets the room. Plain RN Animated on the native driver (works in Expo Go).
 */
export function StaggerGrid<T>({
  items,
  keyOf,
  render,
  header,
  collapsible,
  footer,
  onEndReached,
  onRefresh,
}: {
  items: T[];
  keyOf: (item: T) => string | number;
  render: (item: T, tall: boolean) => ReactNode;
  header?: ReactNode;
  collapsible?: ReactNode;
  footer?: ReactNode;
  onEndReached?: () => void;
  /** Pull to refresh; the spinner stays until the returned promise settles. */
  onRefresh?: () => Promise<unknown>;
}) {
  const c = useColors();
  const blocks = useMemo(() => {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += 4) out.push(items.slice(i, i + 4));
    return out;
  }, [items]);
  const [height, setHeight] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    onRefresh?.().finally(() => setRefreshing(false));
  };
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
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );
  const cell = (item: T | undefined, tall: boolean) => item !== undefined && <View key={keyOf(item)}>{render(item, tall)}</View>;
  const renderBlock: ListRenderItem<T[]> = ({ item: [a, b, c2, d] }) => (
    <View style={styles.row}>
      <View style={styles.column}>
        {cell(a, true)}
        {cell(c2, false)}
      </View>
      <View style={styles.column}>
        {cell(b, false)}
        {cell(d, true)}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <AnimatedList<T[]>
        data={blocks}
        keyExtractor={(block: T[]) => String(keyOf(block[0]))}
        renderItem={renderBlock}
        ItemSeparatorComponent={Gap}
        ListHeaderComponent={<>{header}</>}
        ListFooterComponent={<>{footer}</>}
        contentContainerStyle={[styles.content, { paddingTop: collapsible ? height : 0 }]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={onScroll}
        onEndReached={onEndReached}
        onEndReachedThreshold={1}
        refreshControl={
          onRefresh && (
            <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[c.accent]} tintColor={c.accent} progressViewOffset={height} />
          )
        }
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={7}
      />
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

const Gap = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.screen, paddingBottom: 120 },
  row: { flexDirection: 'row', gap: 14 },
  column: { flex: 1, gap: 14 },
  gap: { height: 14 },
  float: { position: 'absolute', top: 0, left: 0, right: 0 },
});
