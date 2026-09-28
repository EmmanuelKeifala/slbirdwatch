import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { putMnemonic } from '@/api';
import { useAuth } from '@/auth';
import { FormScroll } from '@/FormScroll';
import { Pressable } from '@/Pressable';
import { ScreenHeader } from '@/ScreenHeader';
import { font, radius, space, useColors } from '@/theme';

/** LRN-08 (verifiers): write the memory phrase for a bird's song or call. */
export default function MnemonicEditor() {
  const c = useColors();
  const token = useAuth().session!.token;
  const p = useLocalSearchParams<{ species: string; name: string; text?: string }>();
  const [text, setText] = useState(p.text ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (value: string) => {
    setBusy(true);
    try {
      await putMnemonic(token, Number(p.species), value.trim());
      router.back();
    } catch (e) {
      Alert.alert('Couldn’t save', e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const ok = !busy && text.trim().length >= 3;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Memory phrase" back />
      <FormScroll contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: c.ink }]}>{p.name}</Text>
        <Text style={[styles.hint, { color: c.inkMuted }]}>
          Words that fit the rhythm of its song or call, or what it sounds like: “I am a red-eyed dove”, “like water poured from a bottle”.
        </Text>
        <TextInput
          style={[styles.input, { color: c.ink, backgroundColor: c.field }]}
          value={text}
          onChangeText={setText}
          maxLength={140}
          multiline
          autoFocus
          placeholder="How to remember this call"
          placeholderTextColor={c.inkFaint}
        />
        <Text style={[styles.hint, { color: c.inkFaint, textAlign: 'right' }]}>{text.length} / 140</Text>
        <Pressable
          style={[styles.save, { backgroundColor: c.primary }, !ok && { opacity: 0.4 }]}
          disabled={!ok}
          onPress={() => save(text)}
          accessibilityRole="button"
        >
          <Text style={[styles.saveText, { color: c.onPrimary }]}>{busy ? 'Saving…' : 'Save'}</Text>
        </Pressable>
        {!!p.text && (
          <Pressable onPress={() => save('')} disabled={busy} accessibilityRole="button">
            <Text style={[styles.remove, { color: c.wrong }]}>Remove the phrase</Text>
          </Pressable>
        )}
      </FormScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, gap: space.m, paddingBottom: space.xxl * 2 },
  title: { fontFamily: font.display, fontSize: 26 },
  hint: { fontFamily: font.medium, fontSize: 13, lineHeight: 19 },
  input: {
    minHeight: 110,
    borderRadius: radius.tile,
    padding: space.m,
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  save: { height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: font.semibold, fontSize: 15 },
  remove: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center', marginTop: space.m },
});
