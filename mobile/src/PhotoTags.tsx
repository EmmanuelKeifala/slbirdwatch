import { StyleSheet, Text, View } from 'react-native';

import type { PhotoTag, SoundTag } from '@/api';
import { Pressable } from '@/Pressable';
import { font, radius, space, useColors } from '@/theme';

// LIB-08: photo tags, in display order, and the pairs that can't both apply (the server checks too).
const TAGS: { tag: PhotoTag; label: string }[] = [
  { tag: 'male', label: 'Male' },
  { tag: 'female', label: 'Female' },
  { tag: 'juvenile', label: 'Young' },
  { tag: 'adult', label: 'Adult' },
  { tag: 'breeding', label: 'Breeding' },
  { tag: 'non-breeding', label: 'Non-breeding' },
  { tag: 'in-flight', label: 'In flight' },
];
/** LIB-09: tags for recordings, same words as the Xeno-canto sound gallery. */
export const SOUND_TAGS: { tag: SoundTag; label: string }[] = [
  { tag: 'song', label: 'Song' },
  { tag: 'call', label: 'Call' },
  { tag: 'alarm', label: 'Alarm' },
  { tag: 'flight', label: 'Flight call' },
];
type Tag = PhotoTag | SoundTag;
const ALL: { tag: Tag; label: string }[] = [...TAGS, ...SOUND_TAGS];
const CLASH: [Tag, Tag][] = [
  ['male', 'female'],
  ['juvenile', 'adult'],
  ['breeding', 'non-breeding'],
  ['juvenile', 'breeding'],
];

export const tagText = (tags: Tag[]) =>
  ALL.filter((t) => tags.includes(t.tag))
    .map((t) => t.label)
    .join(' · ');

/** Turning a tag on drops any tag it clashes with. */
function toggleTag<T extends Tag>(tags: T[], tag: T): T[] {
  if (tags.includes(tag)) return tags.filter((t) => t !== tag);
  const out = CLASH.flatMap(([a, b]) => (a === tag ? [b] : b === tag ? [a] : []));
  return ALL.map((t) => t.tag as T).filter((t) => t === tag || (tags.includes(t) && !out.includes(t)));
}

/** Wrapping on/off chips for a photo's tags. `dark` for the full-screen viewer. */
export function TagEditor<T extends Tag>({
  tags,
  onChange,
  dark,
  options = TAGS as { tag: T; label: string }[],
}: {
  tags: T[];
  onChange: (t: T[]) => void;
  dark?: boolean;
  options?: { tag: T; label: string }[];
}) {
  const c = useColors();
  return (
    <View style={styles.wrap}>
      {options.map(({ tag, label }) => {
        const on = tags.includes(tag);
        return (
          <Pressable
            key={tag}
            onPress={() => onChange(toggleTag(tags, tag))}
            style={[styles.chip, { backgroundColor: on ? c.accent : dark ? 'rgba(255,255,255,0.12)' : c.field }]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
          >
            <Text style={[styles.text, { color: on ? c.onAccent : dark ? '#FFFFFF' : c.ink }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 7 },
  text: { fontFamily: font.semibold, fontSize: 13 },
});
