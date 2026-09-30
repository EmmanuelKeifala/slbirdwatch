import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import * as api from '@/api';
import { googleSignOut } from '@/state/googleAuth';
import { forgetAccountStats } from '@/state/quizStore';
import { unregisterPush } from '@/state/pushToken';

const KEY = 'session';

type AuthState = {
  ready: boolean; // false until the stored session has been read
  session: api.Session | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<void>;
  signInWithGoogle(idToken: string): Promise<void>; // ACC-02b
  signOut(): Promise<void>;
  deleteAccount(password: string): Promise<void>;
  setUser(user: api.User): Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<api.Session | null>(null);

  async function save(s: api.Session | null) {
    setSession(s);
    if (s) await SecureStore.setItemAsync(KEY, JSON.stringify(s));
    else await SecureStore.deleteItemAsync(KEY);
  }

  useEffect(() => {
    (async () => {
      const raw = await SecureStore.getItemAsync(KEY).catch(() => null);
      const stored: api.Session | null = raw ? JSON.parse(raw) : null;
      setSession(stored);
      setReady(true);
      if (!stored) return;
      // Refresh the profile; offline keeps the stored session, a rejected token signs out.
      try {
        const user = await api.me(stored.token);
        await save({ ...stored, user });
      } catch (e) {
        if (e instanceof api.ApiError && e.status === 401) await save(null);
      }
    })();
  }, []);

  const value: AuthState = {
    ready,
    session,
    signIn: async (email, password) => save(await api.signIn(email, password)),
    signUp: async (email, password, displayName) => save(await api.signUp(email, password, displayName)),
    signInWithGoogle: async (idToken) => save(await api.signInWithGoogle(idToken)),
    signOut: async () => {
      if (session) await unregisterPush(session.token); // NTF-01: stop pushes to this phone
      await googleSignOut(); // ACC-02b: next sign-in shows Google's account picker again
      forgetAccountStats(); // ACC-04: this phone's quiz numbers only, once signed out
      if (session) await api.signOut(session.token).catch(() => {}); // local sign-out even if offline
      await save(null);
    },
    setUser: async (user) => {
      if (session) await save({ ...session, user });
    },
    deleteAccount: async (password) => {
      if (!session) return;
      await api.deleteAccount(session.token, password);
      await save(null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
