import { Feather } from '@expo/vector-icons';
import { useRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useBringToTop } from '@/FormScroll';

import { Pressable } from '@/Pressable';

import { font, radius, space, useColors } from '@/theme';

export function SearchField({
  value,
  onChange,
  placeholder = 'Search birds by name',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const c = useColors();
  const box = useRef<View>(null);
  const bringToTop = useBringToTop(); // results are listed below the box
  return (
    <View ref={box} style={[styles.box, { backgroundColor: c.field }]}>
      <Feather name="search" size={18} color={c.inkFaint} />
      <TextInput
        style={[styles.input, { color: c.ink }]}
        placeholder={placeholder}
        placeholderTextColor={c.inkFaint}
        value={value}
        onChangeText={onChange}
        autoCorrect={false}
        autoFocus={autoFocus}
        onFocus={() => bringToTop(box.current)}
        returnKeyType="search"
        accessibilityLabel="Search birds"
      />
      {!!value && (
        <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <Feather name="x-circle" size={18} color={c.inkFaint} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    borderRadius: radius.pill,
    paddingHorizontal: space.l,
    height: 54,
  },
  input: { flex: 1, fontFamily: font.regular, fontSize: 15, height: '100%' },
});
