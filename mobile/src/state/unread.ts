import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { myNotifications } from '@/api';

// NTF-01: the unread count behind the bell, shared by every screen that shows it.
let unread = 0;
const listeners = new Set<() => void>();

export function setUnread(n: number) {
  unread = n;
  listeners.forEach((l) => l());
}

export async function refreshUnread(token: string) {
  try {
    setUnread((await myNotifications(token)).unread);
  } catch {
    // offline: keep the last count
  }
}

/** Unread count; polls every minute and when the app comes back to the front. */
export function useUnread(token: string | undefined): number {
  const n = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => unread,
  );
  useEffect(() => {
    if (!token) return setUnread(0);
    refreshUnread(token);
    const timer = setInterval(() => refreshUnread(token), 60_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refreshUnread(token));
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [token]);
  return n;
}
