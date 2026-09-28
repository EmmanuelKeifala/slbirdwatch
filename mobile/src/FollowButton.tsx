import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { followUser, myFollowing, unfollowUser } from '@/api';
import { Pressable } from '@/Pressable';
import { font, radius, space, useColors } from '@/theme';

/** COM-01: follow or unfollow someone (their verified sightings then show in your activity feed). */
export function FollowButton({ token, userId, name }: { token: string; userId: number; name: string }) {
  const c = useColors();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    myFollowing(token).then((r) => setOn(r.items.some((p) => p.id === userId)), () => setOn(false));
  }, [token, userId]);
  if (on === null) return null;
  const toggle = () => {
    setOn(!on); // show it now; put it back if the server says no
    (on ? unfollowUser : followUser)(token, userId).catch(() => setOn(on));
  };
  return (
    <Pressable
      onPress={toggle}
      style={[styles.btn, on ? { backgroundColor: c.tint } : { backgroundColor: c.primary }]}
      accessibilityRole="button"
      accessibilityLabel={on ? `Unfollow ${name}` : `Follow ${name}`}
    >
      <Feather name={on ? 'user-check' : 'user-plus'} size={15} color={on ? c.ink : c.onPrimary} />
      <Text style={[styles.text, { color: on ? c.ink : c.onPrimary }]}>{on ? `Following ${name}` : `Follow ${name}`}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, borderRadius: radius.pill, paddingHorizontal: space.l, height: 38 },
  text: { fontFamily: font.semibold, fontSize: 13 },
});
