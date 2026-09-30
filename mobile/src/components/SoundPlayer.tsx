import { Feather } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { mediaUrl } from '@/api';
import { Pressable } from '@/components/Pressable';
import { font, radius, space, useColors } from '@/theme';
import { fmt } from '@/lib/trim';

type Playable = { url: string; spectrogram_url: string; duration_s: number };

/**
 * A recording as a little night-sky card: a big play button that pulses while it plays, the time, and the
 * spectrogram, which lights up as the sound passes (the rest stays dimmed) under a glowing playhead.
 * Tap anywhere on the spectrogram to jump there. `caption` = credit / licence line.
 */
export function SoundPlayer({ sound, caption }: { sound: Playable; caption?: string }) {
  const c = useColors();
  const player = useAudioPlayer(mediaUrl(sound.url));
  const status = useAudioPlayerStatus(player);
  const [width, setWidth] = useState(1);
  const [pulse] = useState(() => new Animated.Value(0));
  const total = status.duration || sound.duration_s;
  const at = Math.min(width, (status.currentTime / (total || 1)) * width);

  useEffect(() => {
    if (!status.playing) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [status.playing, pulse]);

  function toggle() {
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish || status.currentTime >= total - 0.05) player.seekTo(0);
      player.play();
    }
  }

  const seek = (x: number) => {
    player.seekTo(Math.max(0, Math.min(total, (x / width) * total)));
    if (!status.playing) player.play();
  };

  return (
    <View style={{ gap: 6 }}>
      <LinearGradient colors={[c.night[0], c.night[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={styles.top}>
          <Pressable
            onPress={toggle}
            style={({ pressed }) => [styles.playWrap, pressed && { transform: [{ scale: 0.92 }] }]}
            accessibilityRole="button"
            accessibilityLabel={status.playing ? 'Pause' : 'Play'}
          >
            <Animated.View
              style={[
                styles.ring,
                {
                  opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
                  transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
                },
              ]}
            />
            <View style={styles.play}>
              <Feather name={status.playing ? 'pause' : 'play'} size={20} color={c.night[0]} style={!status.playing && { marginLeft: 2 }} />
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.time}>
              {fmt(status.currentTime)} <Text style={styles.total}>/ {fmt(total)}</Text>
            </Text>
            <Text style={styles.hint}>{status.playing ? 'Listening…' : 'Tap the picture to jump'}</Text>
          </View>
          <Feather name="activity" size={18} color="#C9C2FF" />
        </View>

        <Pressable
          onPress={(e) => seek(e.nativeEvent.locationX)}
          style={styles.spectro}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          accessibilityRole="adjustable"
          accessibilityLabel="Spectrogram. Tap to jump to a moment in the recording."
        >
          {!!sound.spectrogram_url && ( // offline pack calls come without one (LIB-11)
            <Image source={{ uri: mediaUrl(sound.spectrogram_url) }} style={StyleSheet.absoluteFill} contentFit="fill" />
          )}
          <View style={[styles.dim, { left: at }]} pointerEvents="none" />
          {status.currentTime > 0 && (
            <View style={[styles.head, { left: Math.max(0, at - 1) }]} pointerEvents="none">
              <View style={styles.knob} />
            </View>
          )}
        </Pressable>
      </LinearGradient>
      {!!caption && (
        <Text style={[styles.meta, { color: c.inkFaint }]} numberOfLines={1}>
          {caption}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, padding: space.m, gap: space.m },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  playWrap: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF' },
  play: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  time: { fontFamily: font.display, fontSize: 20, color: '#FFFFFF' },
  total: { fontFamily: font.semibold, fontSize: 13, color: '#C9C2FF' },
  hint: { fontFamily: font.medium, fontSize: 12, color: '#C9C2FF' },
  spectro: { height: 96, borderRadius: radius.tile, overflow: 'hidden', backgroundColor: '#0B0A1F' },
  dim: { position: 'absolute', top: 0, bottom: 0, right: 0, backgroundColor: 'rgba(11,10,31,0.55)' },
  head: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#FFFFFF', alignItems: 'center' },
  knob: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFFFF', marginTop: -2, shadowColor: '#FFFFFF', shadowOpacity: 0.9, shadowRadius: 6 },
  meta: { fontFamily: font.medium, fontSize: 11, marginLeft: space.s },
});
