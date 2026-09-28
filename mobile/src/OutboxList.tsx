import { Feather } from '@expo/vector-icons';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';

import { discard, retryNow, type OutboxItem } from '@/outbox';
import { Pressable } from '@/Pressable';
import { font, radius, space, useColors } from '@/theme';

const STATUS: Record<OutboxItem['state'], { icon: React.ComponentProps<typeof Feather>['name']; text: string }> = {
  waiting: { icon: 'clock', text: 'Waiting to upload' },
  uploading: { icon: 'upload-cloud', text: 'Uploading…' },
  offline: { icon: 'wifi-off', text: 'Saved on your phone. It uploads when you have signal.' },
  retry: { icon: 'refresh-cw', text: 'Upload hit a problem; trying again soon' },
  signin: { icon: 'log-in', text: 'Sign in again to upload' },
  failed: { icon: 'alert-circle', text: 'Couldn’t upload' },
};

/** OBS-09: sightings saved on the phone that haven't reached the server yet, with their status. */
export function OutboxList({ items }: { items: OutboxItem[] }) {
  const c = useColors();
  if (!items.length) return null;
  return (
    <View style={[styles.box, { backgroundColor: c.field }]}>
      <Text style={[styles.title, { color: c.ink }]}>
        Not uploaded yet · {items.length}
      </Text>
      {items.map((it) => {
        const st = STATUS[it.state];
        const left = it.photos.length + it.sounds.length;
        return (
          <View key={it.id} style={styles.row}>
            {it.photos[0] ? (
              <Image source={{ uri: it.photos[0] }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, { backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }]}>
                <Feather name="feather" size={18} color={c.tintIcon} />
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.name, { color: c.ink }]} numberOfLines={1}>
                {it.label}
              </Text>
              <View style={styles.statusRow}>
                <Feather name={st.icon} size={12} color={it.state === 'failed' ? c.wrong : c.inkMuted} />
                <Text style={[styles.status, { color: it.state === 'failed' ? c.wrong : c.inkMuted }]} numberOfLines={2}>
                  {it.state === 'failed' && it.error ? `${st.text}: ${it.error}` : st.text}
                  {it.serverId && left ? ` · ${left} file${left > 1 ? 's' : ''} to go` : ''}
                </Text>
              </View>
            </View>
            {it.state !== 'uploading' && (
              <View style={styles.actions}>
                <Pressable onPress={() => retryNow(it.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Try uploading now">
                  <Feather name="refresh-cw" size={18} color={c.accentDeep} />
                </Pressable>
                <Pressable
                  onPress={() =>
                    Alert.alert(
                      'Delete this sighting?',
                      it.serverId ? 'It is already on the server; this only stops its remaining files uploading.' : 'It hasn’t been uploaded, so it will be lost.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => discard(it.id) },
                      ],
                    )
                  }
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Delete from the upload queue"
                >
                  <Feather name="trash-2" size={18} color={c.inkMuted} />
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.card, padding: space.l, gap: space.m, marginBottom: space.l },
  title: { fontFamily: font.bold, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  thumb: { width: 48, height: 48, borderRadius: radius.chip },
  name: { fontFamily: font.semibold, fontSize: 15 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  status: { flex: 1, fontFamily: font.medium, fontSize: 12 },
  actions: { flexDirection: 'row', gap: space.l },
});
