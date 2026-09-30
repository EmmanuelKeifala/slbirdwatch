import { Feather } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/Pressable';

import { previewAudio } from '@/api';
import { useAuth } from '@/auth';
import { classify } from '@/outboxRules';
import { font, radius, space, useColors } from '@/theme';
import { fmt, initialTrim, moveHandle, type Trim } from '@/trim';

export type PendingSound = { uri: string; mimeType?: string; start: number; end: number; spectrogram: string };

type Loaded = { uri: string; mimeType?: string; duration: number; spectrogram: string };

/** OBS-03: record (or pick) a call, then trim it on its spectrogram. */
export function SoundRecorder({ onAdd, onCancel }: { onAdd: (s: PendingSound) => void; onCancel: () => void }) {
  const c = useColors();
  const { session } = useAuth();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rec = useAudioRecorderState(recorder, 250);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(uri: string, mimeType?: string, recordedSeconds?: number) {
    setBusy(true);
    setError(null);
    try {
      const p = await previewAudio(session!.token, uri, mimeType);
      setLoaded({ uri, mimeType, duration: p.duration_s, spectrogram: p.spectrogram });
    } catch (e) {
      if (classify(e) === 'offline' && recordedSeconds) {
        // OBS-09: no signal to draw the spectrogram for trimming; keep the recording (up to 60 s) and queue it.
        onAdd({ uri, mimeType, start: 0, end: Math.min(recordedSeconds, 60), spectrogram: '' });
      } else if (classify(e) === 'offline') {
        setError('Trimming a file needs a connection. Record instead, or add the file when you’re back online.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    setError(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('Allow microphone access in Settings to record bird calls.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function stopRecording() {
    const seconds = rec.durationMillis / 1000; // read before stopping, the state resets
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (recorder.uri) await load(recorder.uri, 'audio/mp4', seconds);
  }

  async function pickFile() {
    const r = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (!r.canceled) await load(r.assets[0].uri, r.assets[0].mimeType ?? undefined);
  }

  if (loaded) {
    return (
      <TrimEditor
        sound={loaded}
        onDone={(t) => onAdd({ uri: loaded.uri, mimeType: loaded.mimeType, spectrogram: loaded.spectrogram, ...t })}
        onCancel={() => setLoaded(null)}
      />
    );
  }

  return (
    <View style={[styles.box, { borderColor: c.border }]}>
      {busy ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
          <Text style={[styles.hint, { color: c.inkMuted }]}>Drawing the spectrogram…</Text>
        </View>
      ) : rec.isRecording ? (
        <View style={styles.center}>
          <Text style={[styles.timer, { color: c.ink }]}>{fmt(rec.durationMillis / 1000)}</Text>
          <Text style={[styles.hint, { color: c.inkMuted }]}>Recording… hold the phone towards the bird</Text>
          <Pressable
            style={[styles.stop, { backgroundColor: c.wrong }]}
            onPress={stopRecording}
            accessibilityRole="button"
            accessibilityLabel="Stop recording"
          >
            <View style={styles.stopSquare} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.row}>
          <Pressable style={[styles.choice, { backgroundColor: c.tint }]} onPress={startRecording} accessibilityRole="button">
            <Feather name="mic" size={22} color={c.tintIcon} />
            <Text style={[styles.choiceText, { color: c.ink }]}>Record</Text>
          </Pressable>
          <Pressable style={[styles.choice, { backgroundColor: c.tint }]} onPress={pickFile} accessibilityRole="button">
            <Feather name="file" size={22} color={c.tintIcon} />
            <Text style={[styles.choiceText, { color: c.ink }]}>Choose file</Text>
          </Pressable>
        </View>
      )}
      {error && <Text style={[styles.hint, { color: c.wrong, textAlign: 'center' }]}>{error}</Text>}
      {!rec.isRecording && !busy && (
        <Pressable onPress={onCancel} accessibilityRole="button">
          <Text style={[styles.link, { color: c.inkMuted }]}>Cancel</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Spectrogram with a draggable selection: a touch moves whichever handle is nearest. */
function TrimEditor({ sound, onDone, onCancel }: { sound: Loaded; onDone: (t: Trim) => void; onCancel: () => void }) {
  const c = useColors();
  const { duration } = sound;
  const [trim, setTrim] = useState(() => initialTrim(duration));
  const [width, setWidth] = useState(1);
  const widthRef = useRef(1);
  const active = useRef<'start' | 'end'>('start');
  const player = useAudioPlayer(sound.uri);
  const status = useAudioPlayerStatus(player);

  // Stop at the end of the selection.
  useEffect(() => {
    if (status.playing && status.currentTime >= trim.end) player.pause();
  }, [status.playing, status.currentTime, trim.end, player]);

  const at = (locationX: number) => (locationX / widthRef.current) * duration;

  const x = (t: number) => (t / duration) * width;
  async function playSelection() {
    if (status.playing) {
      player.pause();
      return;
    }
    await player.seekTo(trim.start);
    player.play();
  }

  return (
    <View style={[styles.box, { borderColor: c.border }]}>
      <Text style={[styles.hint, { color: c.inkMuted }]}>Drag on the spectrogram to keep just the bird</Text>
      <View
        style={styles.spectro}
        onLayout={(e) => {
          widthRef.current = e.nativeEvent.layout.width;
          setWidth(e.nativeEvent.layout.width);
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          const t = at(e.nativeEvent.locationX);
          active.current = Math.abs(t - trim.start) <= Math.abs(t - trim.end) ? 'start' : 'end';
          setTrim((prev) => moveHandle(prev, active.current, t, duration));
        }}
        onResponderMove={(e) => {
          const t = at(e.nativeEvent.locationX);
          setTrim((prev) => moveHandle(prev, active.current, t, duration));
        }}
        accessibilityLabel={`Selection ${fmt(trim.start)} to ${fmt(trim.end)}`}
      >
        <Image source={{ uri: sound.spectrogram }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
        <View pointerEvents="none" style={[styles.shade, { left: 0, width: x(trim.start) }]} />
        <View pointerEvents="none" style={[styles.shade, { left: x(trim.end), right: 0 }]} />
        <View pointerEvents="none" style={[styles.handle, { left: x(trim.start) - 2 }]} />
        <View pointerEvents="none" style={[styles.handle, { left: x(trim.end) - 2 }]} />
        {status.playing && <View pointerEvents="none" style={[styles.playhead, { left: x(status.currentTime) }]} />}
      </View>
      <Text style={[styles.range, { color: c.ink }]}>
        {fmt(trim.start)} – {fmt(trim.end)} · {(trim.end - trim.start).toFixed(1)} s
      </Text>
      <View style={styles.row}>
        <Pressable style={[styles.secondary, { borderColor: c.border }]} onPress={playSelection} accessibilityRole="button">
          <Feather name={status.playing ? 'pause' : 'play'} size={16} color={c.ink} />
          <Text style={[styles.secondaryText, { color: c.ink }]}>{status.playing ? 'Pause' : 'Play selection'}</Text>
        </Pressable>
        <Pressable
          style={[styles.primary, { backgroundColor: c.primary }]}
          onPress={() => {
            player.pause();
            onDone(trim);
          }}
          accessibilityRole="button"
        >
          <Text style={[styles.primaryText, { color: c.onPrimary }]}>Add sound</Text>
        </Pressable>
      </View>
      <Pressable onPress={onCancel} accessibilityRole="button">
        <Text style={[styles.link, { color: c.inkMuted }]}>Discard</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1.5, borderRadius: radius.card, padding: space.l, gap: space.m, marginBottom: space.m },
  center: { alignItems: 'center', gap: space.m, paddingVertical: space.l },
  row: { flexDirection: 'row', gap: space.s },
  choice: { flex: 1, height: 88, borderRadius: radius.tile, alignItems: 'center', justifyContent: 'center', gap: 6 },
  choiceText: { fontFamily: font.semibold, fontSize: 14 },
  timer: { fontFamily: font.display, fontSize: 40 },
  hint: { fontFamily: font.medium, fontSize: 13 },
  stop: { width: 64, height: 64, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 22, height: 22, borderRadius: 4, backgroundColor: '#FFFFFF' },
  spectro: { height: 120, borderRadius: radius.chip, overflow: 'hidden', backgroundColor: '#1B1150' },
  shade: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.55)' },
  handle: { position: 'absolute', top: 0, bottom: 0, width: 4, borderRadius: 2, backgroundColor: '#FFFFFF' },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#F2A900' },
  range: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center' },
  primary: { flex: 1, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: font.semibold, fontSize: 15 },
  secondary: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontFamily: font.semibold, fontSize: 15 },
  link: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center', paddingVertical: space.xs },
});
