import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ComponentProps } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';

import { BirdArt } from '@/BirdArt';
import { Pressable } from '@/Pressable';
import { font, radius, space, tileFor, useColors } from '@/theme';

type Icon = ComponentProps<typeof Feather>['name'];
export type HeroAction = { icon: Icon; label: string; count?: number; onPress: () => void };

/**
 * The big picture at the top of a bird or sighting page: the photo fades and settles in, a soft gradient
 * grounds it, small frosted chips carry context, and frosted pill buttons float along the bottom.
 * Without a photo, the bird's illustration sits on its pastel tile.
 */
export function HeroMedia({ id, uri, chips = [], actions }: { id: number; uri: string | null; chips?: string[]; actions: HeroAction[] }) {
  const c = useColors();
  const [shown] = useState(() => new Animated.Value(0)); // fade/settle-in progress, created once
  const reveal = () => Animated.timing(shown, { toValue: 1, duration: 450, useNativeDriver: true }).start();

  return (
    <View style={[styles.card, { backgroundColor: tileFor(c, id) }]}>
      {uri ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { opacity: shown, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1] }) }] },
          ]}
        >
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onLoad={reveal} />
        </Animated.View>
      ) : (
        <View style={styles.art}>
          <BirdArt id={id} size={250} />
        </View>
      )}
      <LinearGradient
        colors={uri ? ['rgba(23,20,75,0)', 'rgba(23,20,75,0.55)'] : ['rgba(23,20,75,0)', 'rgba(23,20,75,0.12)']}
        style={styles.fade}
        pointerEvents="none"
      />

      {chips.length > 0 && (
        <View style={styles.chips} pointerEvents="none">
          {chips.map((t) => (
            <View key={t} style={styles.chip}>
              <Text style={[styles.chipText, { color: c.ink }]}>{t}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.bar}>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            onPress={a.onPress}
            style={({ pressed }) => [styles.pill, pressed && { transform: [{ scale: 0.94 }], opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel={a.count !== undefined ? `${a.label}, ${a.count}` : a.label}
          >
            <View style={[styles.pillIcon, { backgroundColor: c.primary }]}>
              <Feather name={a.icon} size={14} color={c.onPrimary} />
            </View>
            <Text style={[styles.pillText, { color: c.ink }]} numberOfLines={1}>
              {a.label}
              {a.count ? <Text style={{ color: c.inkMuted }}> {a.count}</Text> : null}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 360,
    marginHorizontal: space.screen,
    marginTop: space.s,
    borderRadius: 32,
    overflow: 'hidden',
    shadowColor: '#17144B',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  art: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 170 },
  chips: { position: 'absolute', top: space.l, left: space.l, right: space.l, flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: { backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 5 },
  chipText: { fontFamily: font.semibold, fontSize: 12 },
  bar: { position: 'absolute', left: space.m, right: space.m, bottom: space.m, flexDirection: 'row', gap: space.s },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: space.s,
    shadowColor: '#17144B',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  pillIcon: { width: 26, height: 26, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontFamily: font.bold, fontSize: 13, flexShrink: 1 },
});
