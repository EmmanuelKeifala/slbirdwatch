import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { savePushToken } from '@/api';
import { useAuth } from '@/state/auth';
import { setDeviceToken } from '@/state/pushToken';
import { refreshUnread } from '@/state/unread';

// NTF-01 push. Needs a development or store build (Expo Go on Android can't receive remote push) and a real phone.
// The server pushes the same notifications as the in-app inbox; tapping one opens the sighting.

const pushable = Device.isDevice && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

async function register(sessionToken: string) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Sightings',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const perm = await Notifications.getPermissionsAsync();
  const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await savePushToken(sessionToken, data, Platform.OS, (Device.modelName ?? Device.deviceName ?? '').slice(0, 80));
  setDeviceToken(data);
}

/** Registers this phone after sign-in and opens the sighting when a notification is tapped. Renders nothing. */
export function PushSetup() {
  const token = useAuth().session?.token;
  const last = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (pushable && token) register(token).catch(() => {}); // no permission or offline: the inbox still works
  }, [token]);

  useEffect(() => {
    const data = last?.notification.request.content.data;
    if (typeof data?.observation_id === 'number') router.push(`/sighting/${data.observation_id}`);
    else if (data?.url === '/learn' || data?.url === '/quiz' || data?.url === '/') router.push(data.url); // NTF-02 reminders
    else if (typeof data?.url === 'string' && /^\/event\/[a-z0-9-]+$/.test(data.url)) router.push(data.url as `/event/${string}`); // GAM-06
  }, [last]);

  useEffect(() => {
    if (!token) return;
    const sub = Notifications.addNotificationReceivedListener(() => refreshUnread(token));
    return () => sub.remove();
  }, [token]);

  return null;
}
