import Constants from 'expo-constants';

// ACC-02b: native Google sign-in. The module isn't in Expo Go, so it's loaded lazily; without it the
// "Continue with Google" button is simply hidden.
type Module = typeof import('@react-native-google-signin/google-signin');

let mod: Module | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose: absent in Expo Go
  mod = require('@react-native-google-signin/google-signin') as Module;
  mod.GoogleSignin.configure({ webClientId: Constants.expoConfig?.extra?.googleWebClientId as string });
} catch {
  mod = null;
}

export const googleAvailable = mod !== null;

/** Opens Google's account picker; resolves to an ID token, or null if the person cancelled. */
export async function googleIdToken(): Promise<string | null> {
  if (!mod) throw new Error('Google sign-in needs the SL Birdwatch app build, not Expo Go.');
  const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = mod;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) return null;
    if (!res.data.idToken) throw new Error('Google didn’t return a sign-in token. Try again.');
    return res.data.idToken;
  } catch (e) {
    if (isErrorWithCode(e) && e.code === statusCodes.IN_PROGRESS) return null;
    throw e;
  }
}

/** Forget the Google account on this phone, so the next sign-in shows the account picker again. */
export async function googleSignOut() {
  await mod?.GoogleSignin.signOut().catch(() => {});
}
