import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/Pressable';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FlyingBird } from '@/BirdArt';
import { useOnboarding } from '@/onboarding';
import { font, radius, space, useColors } from '@/theme';

// Star positions as fractions of the screen, so the sky looks the same on every phone.
const STARS = [
  [0.72, 0.07, 3], [0.55, 0.1, 2], [0.12, 0.2, 5], [0.83, 0.18, 3], [0.9, 0.36, 2],
  [0.2, 0.46, 2], [0.47, 0.5, 4], [0.86, 0.5, 2], [0.1, 0.56, 2], [0.62, 0.6, 3],
] as const;

/** First-launch welcome — design/refs/screen-onboarding.png. No login wall (ACC-01). */
export default function Welcome() {
  const c = useColors();
  const { finish } = useOnboarding();
  return (
    <LinearGradient colors={c.night} locations={[0, 0.35, 0.72, 1]} style={styles.screen}>
      {STARS.map(([x, y, size], i) => (
        <View
          key={i}
          style={[styles.star, { left: `${x * 100}%`, top: `${y * 100}%`, width: size, height: size, borderRadius: size }]}
        />
      ))}
      {/* crescent moon: a pale disc with a sky-coloured disc over it */}
      <View style={styles.moon}>
        <View style={[styles.moonShade, { backgroundColor: c.night[0] }]} />
      </View>

      <SafeAreaView style={styles.content}>
        <View style={styles.art}>
          <FlyingBird size={300} />
          <View style={styles.bubble}>
            <Feather name="music" size={22} color={c.accentDeep} />
          </View>
        </View>

        <View style={{ gap: space.l }}>
          <Text style={styles.title} accessibilityRole="header">
            Discover{'\n'}who’s singing
          </Text>
          <Text style={styles.body}>
            Log the birds you see and hear, explore a library built by local birders, and train your eye and ear to name
            them yourself.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.button, { backgroundColor: c.night[0] }, pressed && { opacity: 0.9 }]}
            onPress={finish}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Get started</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  star: { position: 'absolute', backgroundColor: '#FFFFFF', opacity: 0.85 },
  moon: {
    position: 'absolute',
    top: '8%',
    left: '14%',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F7EFC8',
    overflow: 'hidden',
  },
  moonShade: { position: 'absolute', width: 44, height: 44, borderRadius: 22, left: 12, top: -8 },
  content: { flex: 1, justifyContent: 'space-between', paddingHorizontal: space.xl, paddingBottom: space.xl },
  art: { alignItems: 'center', marginTop: '22%' },
  bubble: {
    position: 'absolute',
    right: -8,
    top: -24,
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: font.display, fontSize: 46, lineHeight: 48, color: '#FFFFFF' },
  body: { fontFamily: font.medium, fontSize: 15, lineHeight: 24, color: 'rgba(255,255,255,0.85)' },
  button: { height: 58, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginTop: space.m },
  buttonText: { fontFamily: font.semibold, fontSize: 16, color: '#FFFFFF' },
});
