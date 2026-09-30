import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const KEY = 'onboarded';

type Onboarding = { seen: boolean | null; finish(): void }; // seen = null while loading

const Ctx = createContext<Onboarding>({ seen: null, finish: () => {} });

/** Remembers whether the welcome screen has been shown on this device. */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((v) => setSeen(v === '1'))
      .catch(() => setSeen(false));
  }, []);
  const finish = () => {
    setSeen(true);
    SecureStore.setItemAsync(KEY, '1').catch(() => {});
  };
  return <Ctx.Provider value={{ seen, finish }}>{children}</Ctx.Provider>;
}

export const useOnboarding = () => useContext(Ctx);
