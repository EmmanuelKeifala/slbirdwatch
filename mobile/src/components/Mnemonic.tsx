import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { isVerifier } from '@/api';
import { useAuth } from '@/state/auth';
import { Pressable } from '@/components/Pressable';
import { font, radius, space, useColors } from '@/theme';

/** LRN-08: a memory phrase for a bird's song or call, next to the recording. Verifiers can write or change it. */
export function Mnemonic({ speciesId, name, text }: { speciesId: number; name: string; text: string }) {
  const c = useColors();
  const { session } = useAuth();
  const expert = isVerifier(session?.user);
  if (!text && !expert) return null;
  const edit = () => router.push({ pathname: '/mnemonic', params: { species: String(speciesId), name, text } });
  return text ? (
    <View style={[styles.box, { backgroundColor: c.tint }]} accessible accessibilityLabel={`Remember it: ${text}`}>
      <Feather name="headphones" size={16} color={c.tintIcon} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.label, { color: c.inkMuted }]}>Remember it</Text>
        <Text style={[styles.text, { color: c.ink }]}>{text}</Text>
      </View>
      {expert && (
        <Pressable onPress={edit} hitSlop={10} accessibilityRole="button" accessibilityLabel="Edit the memory phrase">
          <Feather name="edit-2" size={16} color={c.inkMuted} />
        </Pressable>
      )}
    </View>
  ) : (
    <Pressable onPress={edit} accessibilityRole="button">
      <Text style={[styles.add, { color: c.accentDeep }]}>＋ Add a memory phrase for this call</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'flex-start', gap: space.m, borderRadius: radius.tile, padding: space.m },
  label: { fontFamily: font.semibold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  text: { fontFamily: font.medium, fontSize: 15, lineHeight: 21 },
  add: { fontFamily: font.semibold, fontSize: 13 },
});
