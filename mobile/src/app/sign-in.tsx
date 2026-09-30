import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { FormScroll } from '@/components/FormScroll';
import { Pressable } from '@/components/Pressable';

import { useLocalSearchParams } from 'expo-router';

import { AntDesign } from '@expo/vector-icons';

import { useAuth } from '@/state/auth';
import { googleAvailable, googleIdToken } from '@/state/googleAuth';
import { afterSignIn, close } from '@/lib/nav';
import { font, radius, space, useColors, type Colors } from '@/theme';

export default function SignIn() {
  const c = useColors();
  const s = styles(c);
  const auth = useAuth();
  const { why, next } = useLocalSearchParams<{ why?: string; next?: string }>();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function google() {
    setBusy(true);
    setError(null);
    try {
      const idToken = await googleIdToken();
      if (!idToken) return; // cancelled
      await auth.signInWithGoogle(idToken);
      afterSignIn(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'in') await auth.signIn(email, password);
      else await auth.signUp(email, password, name);
      afterSignIn(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.screen}>
      <FormScroll contentContainerStyle={s.content}>
        <Text style={s.title} accessibilityRole="header">
          {mode === 'in' ? 'Welcome back, birder' : 'Join the flock'}
        </Text>
        <Text style={s.subtitle}>
          {why ??
            (mode === 'in'
              ? 'Sign in to upload sightings and save your progress.'
              : 'Create an account to share what you see and track what you learn.')}
        </Text>

        {googleAvailable && (
          <>
            <Pressable style={s.google} onPress={google} disabled={busy} accessibilityRole="button">
              <AntDesign name="google" size={18} color={c.ink} />
              <Text style={s.googleText}>Continue with Google</Text>
            </Pressable>
            <Text style={s.or}>or with email</Text>
          </>
        )}

        {mode === 'up' && (
          <TextInput
            style={s.input}
            placeholder="Display name"
            placeholderTextColor={c.inkMuted}
            value={name}
            onChangeText={setName}
            maxLength={50}
            autoComplete="name"
            accessibilityLabel="Display name"
          />
        )}
        <TextInput
          style={s.input}
          placeholder="Email"
          placeholderTextColor={c.inkMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          accessibilityLabel="Email"
        />
        <TextInput
          style={s.input}
          placeholder={mode === 'up' ? 'Password (8+ characters)' : 'Password'}
          placeholderTextColor={c.inkMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          onSubmitEditing={submit}
          accessibilityLabel="Password"
        />

        {error && (
          <Text style={s.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}

        <Pressable
          style={[s.primary, busy && { opacity: 0.6 }]}
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={c.onPrimary} />
          ) : (
            <Text style={s.primaryText}>{mode === 'in' ? 'Sign in' : 'Create account'}</Text>
          )}
        </Pressable>

        <Pressable
          style={s.secondary}
          onPress={() => {
            setMode(mode === 'in' ? 'up' : 'in');
            setError(null);
          }}
          accessibilityRole="button"
        >
          <Text style={s.secondaryText}>
            {mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </Text>
        </Pressable>
        <Pressable style={s.secondary} onPress={close} accessibilityRole="button">
          <Text style={[s.secondaryText, { color: c.inkMuted }]}>Keep browsing without an account</Text>
        </Pressable>
      </FormScroll>
    </View>
  );
}

const styles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: space.screen, paddingTop: space.xxl, gap: space.m },
    title: { fontFamily: font.display, fontSize: 36, lineHeight: 40, color: c.ink },
    subtitle: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: c.inkMuted, marginBottom: space.l },
    input: {
      fontFamily: font.regular,
      fontSize: 15,
      color: c.ink,
      backgroundColor: c.field,
      borderRadius: radius.pill,
      paddingHorizontal: space.xl,
      height: 52,
    },
    error: { fontFamily: font.medium, fontSize: 14, color: c.wrong },
    primary: {
      backgroundColor: c.primary,
      borderRadius: radius.pill,
      height: 56,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.s,
    },
    primaryText: { fontFamily: font.semibold, fontSize: 16, color: c.onPrimary },
    secondary: { alignItems: 'center', paddingVertical: space.m },
    google: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.s,
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: radius.pill,
      height: 56,
    },
    googleText: { fontFamily: font.semibold, fontSize: 16, color: c.ink },
    or: { fontFamily: font.medium, fontSize: 13, color: c.inkMuted, textAlign: 'center', marginVertical: space.xs },
    secondaryText: { fontFamily: font.semibold, fontSize: 15, color: c.ink },
  });
