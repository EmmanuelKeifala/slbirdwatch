import { Feather } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/components/Pressable';
import { font, space, useColors } from '@/theme';

/**
 * The strip across the top of every game: close on the left, the game's label (or a progress bar) in the
 * middle, the score or round count on the right. With nothing on the right, a spacer keeps the label centred.
 */
export function GameBar({
  onClose,
  closeLabel = 'Quit',
  back,
  label,
  children,
  right,
}: {
  onClose: () => void;
  closeLabel?: string;
  /** An arrow instead of the ✕, for stepping back inside a game. */
  back?: boolean;
  label?: ReactNode;
  /** Custom middle (e.g. a progress bar); takes the place of `label`. */
  children?: ReactNode;
  right?: ReactNode;
}) {
  const c = useColors();
  return (
    <View style={styles.bar}>
      <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={closeLabel}>
        <Feather name={back ? 'arrow-left' : 'x'} size={24} color={c.ink} />
      </Pressable>
      {children ?? <Text style={[styles.label, { color: c.accentDeep }]}>{label}</Text>}
      {right ?? <View style={styles.spacer} />}
    </View>
  );
}

/** Right-hand text for GameBar: a round count or score. */
export function GameBarText({ children, color }: { children: ReactNode; color?: string }) {
  const c = useColors();
  return <Text style={[styles.side, { color: color ?? c.inkMuted }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.screen, paddingVertical: space.m },
  label: { flex: 1, fontFamily: font.bold, fontSize: 12, letterSpacing: 1, textAlign: 'center' },
  side: { fontFamily: font.semibold, fontSize: 13, minWidth: 24, textAlign: 'right' },
  spacer: { width: 24 },
});
