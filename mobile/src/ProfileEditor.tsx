import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, TextInput, View } from 'react-native';

import { Pressable } from '@/Pressable';

import * as api from '@/api';
import { useAuth } from '@/auth';
import { shrink } from '@/images';
import { LICENCES } from '@/licences';
import { font, radius, space, useColors, type Colors } from '@/theme';

const LEVELS: { value: api.ExperienceLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'expert', label: 'Expert' },
];

/** ACC-05: avatar, display name, home area, experience level, bio. */
export function ProfileEditor() {
  const c = useColors();
  const s = styles(c);
  const { session, setUser } = useAuth();
  const user = session!.user;
  const [name, setName] = useState(user.display_name);
  const [homeArea, setHomeArea] = useState(user.home_area);
  const [level, setLevel] = useState(user.experience_level);
  const [bio, setBio] = useState(user.bio);
  const [licence, setLicence] = useState(user.default_licence);
  const [busy, setBusy] = useState<'save' | 'photo' | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const dirty =
    name.trim() !== user.display_name ||
    homeArea.trim() !== user.home_area ||
    level !== user.experience_level ||
    bio.trim() !== user.bio ||
    licence !== user.default_licence;

  async function run(kind: 'save' | 'photo', action: () => Promise<void>, done?: string) {
    setBusy(kind);
    setMessage(null);
    try {
      await action();
      if (done) setMessage({ text: done, error: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run(
      'save',
      async () => {
        const updated = await api.updateProfile(session!.token, {
          display_name: name.trim(),
          home_area: homeArea.trim(),
          experience_level: level,
          bio: bio.trim(),
          default_licence: licence,
        });
        await setUser(updated);
      },
      'Profile saved',
    );

  async function pick(from: 'camera' | 'library') {
    const perm =
      from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setMessage({ text: `Allow ${from === 'camera' ? 'camera' : 'photo'} access in Settings to set a photo.`, error: true });
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
    const result =
      from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled) return;

    await run('photo', async () => {
      await setUser(await api.uploadAvatar(session!.token, await shrink(result.assets[0], 1024)));
    });
  }

  const changePhoto = () =>
    Alert.alert('Profile photo', undefined, [
      { text: 'Take photo', onPress: () => pick('camera') },
      { text: 'Choose from library', onPress: () => pick('library') },
      ...(user.avatar_url
        ? [
            {
              text: 'Remove photo',
              style: 'destructive' as const,
              onPress: () =>
                run('photo', async () => {
                  await api.deleteAvatar(session!.token);
                  await setUser({ ...user, avatar_url: null });
                }),
            },
          ]
        : []),
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <View style={s.card}>
      <Pressable style={s.avatarWrap} onPress={changePhoto} accessibilityRole="button" accessibilityLabel="Change profile photo">
        {user.avatar_url ? (
          <Image source={{ uri: api.mediaUrl(user.avatar_url) }} style={s.avatar} />
        ) : (
          <View style={[s.avatar, s.avatarEmpty]}>
            <Text style={s.avatarInitial}>{user.display_name[0]?.toUpperCase()}</Text>
          </View>
        )}
        {busy === 'photo' ? <ActivityIndicator color={c.ink} /> : <Text style={s.changePhoto}>Change photo</Text>}
      </Pressable>
      <Text style={s.email}>{user.email}</Text>

      <Text style={s.label}>Display name</Text>
      <TextInput style={s.input} value={name} onChangeText={setName} maxLength={50} accessibilityLabel="Display name" />

      <Text style={s.label}>Home area</Text>
      <TextInput
        style={s.input}
        value={homeArea}
        onChangeText={setHomeArea}
        maxLength={80}
        placeholder="e.g. Freetown Peninsula"
        placeholderTextColor={c.inkMuted}
        accessibilityLabel="Home area"
      />

      <Text style={s.label}>Birding experience</Text>
      <View style={s.chips}>
        {LEVELS.map((l) => {
          const on = level === l.value;
          return (
            <Pressable
              key={l.value}
              style={[s.chip, on && s.chipOn]}
              onPress={() => setLevel(on ? '' : l.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[s.chipText, on && { color: c.onAccent }]}>{l.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={s.label}>About you</Text>
      <TextInput
        style={[s.input, s.bio]}
        value={bio}
        onChangeText={setBio}
        maxLength={500}
        multiline
        placeholder="Favourite birds, patches you visit…"
        placeholderTextColor={c.inkMuted}
        accessibilityLabel="About you"
      />
      <Text style={s.counter}>{bio.length}/500</Text>

      <Text style={s.label}>Default licence for my photos</Text>
      <View style={s.chips}>
        {LICENCES.map((l) => {
          const on = licence === l.value;
          return (
            <Pressable
              key={l.value}
              style={[s.chip, on && s.chipOn]}
              onPress={() => setLicence(l.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityHint={l.hint}
            >
              <Text style={[s.chipText, on && { color: c.onAccent }]}>{l.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={s.counter}>{LICENCES.find((l) => l.value === licence)?.hint}</Text>

      {message && (
        <Text style={[s.message, { color: message.error ? c.wrong : c.correct }]} accessibilityLiveRegion="polite">
          {message.text}
        </Text>
      )}
      <Pressable
        style={[s.save, (!dirty || busy !== null || !name.trim()) && { opacity: 0.5 }]}
        onPress={save}
        disabled={!dirty || busy !== null || !name.trim()}
        accessibilityRole="button"
      >
        {busy === 'save' ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.saveText}>Save profile</Text>}
      </Pressable>
    </View>
  );
}

const styles = (c: Colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.card,
      borderColor: c.border,
      borderWidth: 1,
      padding: space.xl,
      gap: space.s,
    },
    avatarWrap: { alignItems: 'center', gap: space.s },
    avatar: { width: 96, height: 96, borderRadius: radius.pill },
    avatarEmpty: { backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' },
    avatarInitial: { fontFamily: font.display, fontSize: 40, color: c.accent },
    changePhoto: { fontFamily: font.semibold, fontSize: 14, color: c.ink },
    email: { fontFamily: font.regular, fontSize: 14, color: c.inkMuted, textAlign: 'center', marginBottom: space.s },
    label: { fontFamily: font.medium, fontSize: 12, color: c.inkMuted, marginTop: space.s },
    input: {
      fontFamily: font.regular,
      fontSize: 15,
      color: c.ink,
      backgroundColor: c.field,
      borderRadius: radius.chip,
      paddingHorizontal: space.l,
      minHeight: 48,
    },
    bio: { minHeight: 96, paddingTop: space.m, textAlignVertical: 'top' },
    counter: { fontFamily: font.regular, fontSize: 12, color: c.inkMuted, textAlign: 'right' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
    chip: {
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: space.l,
      height: 40,
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { fontFamily: font.medium, fontSize: 14, color: c.ink },
    message: { fontFamily: font.medium, fontSize: 14, textAlign: 'center' },
    save: {
      backgroundColor: c.primary,
      borderRadius: radius.pill,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.s,
    },
    saveText: { fontFamily: font.semibold, fontSize: 15, color: c.onPrimary },
  });
