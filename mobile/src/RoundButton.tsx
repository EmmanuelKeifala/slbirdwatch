import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';

import { Pressable } from '@/Pressable';

import { radius, useColors } from '@/theme';

/** Lavender round icon button from design/refs/screen-detail.png. */
export function RoundButton({ icon, label, onPress }: { icon: ComponentProps<typeof Feather>['name']; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      style={({ pressed }) => [styles.round, { backgroundColor: c.tint }, pressed && { opacity: 0.7 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name={icon} size={20} color={c.tintIcon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  round: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
