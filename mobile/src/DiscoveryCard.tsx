import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { Observation } from '@/api';
import { BirdArt } from '@/BirdArt';
import { Pressable } from '@/Pressable';
import { StatusBadge } from '@/StatusBadge';
import { font, radius, space, tileFor, useColors } from '@/theme';

/**
 * A sighting in Your discoveries: the photo fills the card, the name sits on a soft gradient at the bottom,
 * and the status rides in the corner. No photo: the bird's illustration on its pastel tile, dark text.
 */
export function DiscoveryCard({
  tileId,
  title,
  caption,
  uri,
  status,
  tall,
  onPress,
}: {
  tileId: number;
  title: string;
  caption: string;
  uri?: string;
  status: Observation['status'];
  tall: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { height: tall ? 236 : 196, backgroundColor: tileFor(c, tileId) }, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${caption}`}
    >
      {uri ? (
        <>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <LinearGradient colors={['rgba(23,20,75,0)', 'rgba(23,20,75,0.72)']} style={styles.fade} pointerEvents="none" />
        </>
      ) : (
        <View style={styles.art}>
          <BirdArt id={tileId} size={tall ? 132 : 112} />
        </View>
      )}
      <View style={styles.badge}>
        <StatusBadge status={status} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: uri ? '#FFFFFF' : c.ink }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.caption, { color: uri ? '#E3E0FF' : c.inkMuted }]} numberOfLines={1}>
          {caption}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    shadowColor: '#17144B',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  pressed: { transform: [{ scale: 0.97 }] },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%' },
  art: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: space.s, left: space.s },
  text: { padding: space.m, paddingTop: 0 },
  title: { fontFamily: font.bold, fontSize: 16, lineHeight: 20 },
  caption: { fontFamily: font.semibold, fontSize: 12, marginTop: 2 },
});
