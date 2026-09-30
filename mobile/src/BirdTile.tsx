import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import Animated from 'react-native-reanimated';

import { Pressable } from '@/Pressable';

import { BirdArt } from '@/BirdArt';
import { font, radius, space, tileFor, useColors } from '@/theme';

/** Pastel tile holding a bird photo, or an illustrated bird when there's no photo. */
export function BirdTile({
  id,
  uri,
  style,
  artSize = 96,
  sharedTag,
}: {
  id: number;
  uri?: string;
  style?: ViewStyle;
  artSize?: number;
  /** Morphs into the next screen's view with the same tag (Reanimated shared transition; APK builds only). */
  sharedTag?: string;
}) {
  const c = useColors();
  return (
    <Animated.View sharedTransitionTag={sharedTag} style={[styles.tile, { backgroundColor: tileFor(c, id) }, style]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      ) : (
        <View style={styles.art}>
          <BirdArt id={id} size={artSize} />
        </View>
      )}
    </Animated.View>
  );
}

/** White rounded card: pastel bird tile, bold centred name, grey caption (design/refs/screen-discoveries.png). */
export function BirdCard({
  id,
  title,
  caption,
  uri,
  tall,
  onPress,
  prefetch,
  sharedTag,
}: {
  id: number;
  title: string;
  caption: string;
  uri?: string;
  tall?: boolean;
  onPress?: () => void;
  /** Photo the next screen will show: starts downloading as the finger lands, so it is there on arrival. */
  prefetch?: string;
  sharedTag?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      onPressIn={prefetch ? () => Image.prefetch(prefetch).catch(() => {}) : undefined}
      disabled={!onPress}
      style={({ pressed }) => [styles.card, { borderColor: c.border, backgroundColor: c.surface }, pressed && styles.pressed]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${title}, ${caption}`}
    >
      <BirdTile id={id} uri={uri} style={{ height: tall ? 158 : 128 }} artSize={tall ? 104 : 88} sharedTag={sharedTag} />
      <Text style={[styles.title, { color: c.ink }]} numberOfLines={2}>
        {title}
      </Text>
      <Text style={[styles.caption, { color: c.inkMuted }]} numberOfLines={1}>
        {caption}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.tile, overflow: 'hidden' },
  art: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', marginBottom: -10 },
  card: { borderWidth: 1.5, borderRadius: radius.card, padding: 10, paddingBottom: space.l },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  title: { fontFamily: font.bold, fontSize: 15, lineHeight: 19, textAlign: 'center', marginTop: space.m, paddingHorizontal: space.xs },
  caption: { fontFamily: font.semibold, fontSize: 12, lineHeight: 16, textAlign: 'center', marginTop: 2 },
});
