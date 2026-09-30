import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/state/auth';
import { syncOutbox, useOutbox } from '@/state/outbox';
import { resumeTracking, syncOutings } from '@/state/outing';
import { syncQuiz } from '@/state/quizStore';
import { refreshSpeciesCache } from '@/state/speciesCache';

/**
 * OBS-09: uploads queued sightings on launch, when the app comes back to the front, and every 30 s while
 * something is waiting. Also keeps the offline species list fresh. Renders nothing.
 * ponytail: polls instead of listening for network changes; add expo-network if 30 s feels slow.
 */
export function OutboxSync() {
  const { session } = useAuth();
  const token = session?.token;
  const userId = session?.user.id;
  const waiting = useOutbox(userId).length;

  useEffect(() => {
    refreshSpeciesCache().catch(() => {}); // offline now: try again next launch
    resumeTracking(); // OBS-10: an outing left running keeps recording its route when the app reopens
  }, []);

  // ACC-04: a guest's quiz progress joins the account as soon as they sign in (and any offline quizzes later).
  useEffect(() => {
    if (token) syncQuiz(token);
  }, [token]);

  useEffect(() => {
    if (!token || !userId) return;
    const kick = () => void syncOutbox(token, userId).then(() => syncOutings(token, userId));
    kick();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && kick());
    const timer = waiting ? setInterval(kick, 30_000) : undefined;
    return () => {
      sub.remove();
      if (timer) clearInterval(timer);
    };
  }, [token, userId, waiting]);

  return null;
}
