import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { Observation } from '@/api';
import { font, radius, useColors } from '@/theme';

const LABEL = { needs_id: 'Needs ID', community: 'Community ID', verified: 'Verified' } as const;

/** VER-02 status pill. */
export function StatusBadge({ status }: { status: Observation['status'] }) {
  const c = useColors();
  const tone =
    status === 'verified'
      ? { bg: '#E3F5EC', fg: c.correct }
      : status === 'community'
        ? { bg: c.tint, fg: c.accentDeep }
        : { bg: '#FDF1D8', fg: '#A06A00' };
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]} accessibilityLabel={`Status: ${LABEL[status]}`}>
      {status === 'verified' && <Feather name="check-circle" size={13} color={tone.fg} />}
      <Text style={[styles.text, { color: tone.fg }]}>{LABEL[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: { fontFamily: font.bold, fontSize: 12 },
});
