import { deletePushToken } from '@/api';

// This phone's Expo push token once registered (NTF-01). Kept apart from push.ts so auth can unregister
// on sign-out without an import cycle.
let deviceToken: string | null = null;

export const getDeviceToken = () => deviceToken;

export const setDeviceToken = (t: string | null) => {
  deviceToken = t;
};

/** Called on sign-out, so the next person to use this phone doesn't get these pushes. */
export async function unregisterPush(sessionToken: string) {
  if (deviceToken) await deletePushToken(sessionToken, deviceToken).catch(() => {});
  deviceToken = null;
}
