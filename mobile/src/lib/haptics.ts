import * as Haptics from 'expo-haptics';

/** A short buzz when a game marks an answer: success for right, error for wrong. (Only here; not on every tap.) */
export const answerFeel = (right: boolean) =>
  Haptics.notificationAsync(right ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
