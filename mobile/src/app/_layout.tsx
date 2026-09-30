import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_400Regular_Italic,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider, useAuth } from '@/state/auth';
import { OnboardingProvider, useOnboarding } from '@/state/onboarding';
import { OutboxSync } from '@/state/OutboxSync';
import { PushSetup } from '@/state/push';
import { useColors } from '@/theme';

// The native splash stays up until fonts, the stored session and onboarding state are read: no blank frame.
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: true, duration: 200 });

export default function RootLayout() {
  const [loaded, error] = useFonts({
    BricolageGrotesque_800ExtraBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_400Regular_Italic,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });
  // On font load failure, render anyway with the system font.
  if (!loaded && !error) return null;

  return (
    <AuthProvider>
      <OnboardingProvider>
        <AppStack />
        <OutboxSync />
        <PushSetup />
      </OnboardingProvider>
    </AuthProvider>
  );
}

function AppStack() {
  const c = useColors();
  const { seen } = useOnboarding();
  const { ready } = useAuth();
  const loaded = seen !== null && ready;
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);
  if (!loaded) return null;
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Protected guard={!seen}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        <Stack.Protected guard={seen}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="species/[id]" />
          <Stack.Screen name="sighting/[id]" />
          <Stack.Screen name="identify" />
          <Stack.Screen name="guidelines" />
          <Stack.Screen name="blocked" />
          <Stack.Screen name="verify" />
          <Stack.Screen name="moderate" />
          <Stack.Screen name="species-admin/[id]" />
          <Stack.Screen name="sensitive" />
          <Stack.Screen name="people" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="outing/[id]" />
          <Stack.Screen name="lesson/[slug]" />
          <Stack.Screen name="flashcards" />
          <Stack.Screen name="lifelist" />
          <Stack.Screen name="progress" />
          <Stack.Screen name="glossary" />
          <Stack.Screen name="checklist" />
          <Stack.Screen name="achievements" />
          <Stack.Screen name="activity" />
          <Stack.Screen name="admin-lessons" />
          <Stack.Screen name="admin-lesson" />
          <Stack.Screen name="admin-challenges" />
          <Stack.Screen name="admin-analytics" />
          <Stack.Screen name="offline" />
          <Stack.Screen name="leaderboard" />
          <Stack.Screen name="groups" />
          <Stack.Screen name="group/[id]" />
          <Stack.Screen name="group-sightings" />
          <Stack.Screen name="alerts" />
          <Stack.Screen name="event/[slug]" />
          <Stack.Screen name="mnemonic" options={{ presentation: 'modal' }} />
          <Stack.Screen name="tip" options={{ presentation: 'modal' }} />
          <Stack.Screen name="compare" options={{ presentation: 'modal' }} />
          <Stack.Screen name="profile-edit" options={{ presentation: 'modal' }} />
          <Stack.Screen name="quiz" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
          <Stack.Screen name="spot" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
          <Stack.Screen name="speed" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
          <Stack.Screen name="reveal" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
          <Stack.Screen name="chorus" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
          <Stack.Screen name="duel" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
          <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
          <Stack.Screen name="observe" options={{ presentation: 'modal' }} />
        </Stack.Protected>
      </Stack>
      <StatusBar style={seen ? 'dark' : 'light'} />
    </>
  );
}
