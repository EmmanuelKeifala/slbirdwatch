import { Feather } from '@expo/vector-icons';
import { router, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { Pressable } from '@/Pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { mediaUrl } from '@/api';
import { useAuth } from '@/auth';
import { signInFirst } from '@/nav';
import { font, radius, useColors } from '@/theme';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];
type Route = TabBarProps['state']['routes'][number];

const TABS: Record<string, { icon: ComponentProps<typeof Feather>['name']; label: string }> = {
  index: { icon: 'home', label: 'Library' },
  sightings: { icon: 'bookmark', label: 'Your discoveries' },
  learn: { icon: 'book-open', label: 'Learn' },
  games: { icon: 'zap', label: 'Games' },
  profile: { icon: 'user', label: 'Profile' },
};

export default function TabsLayout() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  return (
    // the + lives in this full-screen layer, not in the bar, so Android can hit it above the bar's edge
    <View style={{ flex: 1 }}>
      <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg } }} tabBar={(props) => <TabBar {...props} />}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="sightings" />
        <Tabs.Screen name="learn" />
        <Tabs.Screen name="games" />
        <Tabs.Screen name="profile" />
      </Tabs>
      <Pressable
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: c.primary, bottom: Math.max(insets.bottom, 12) + BAR + 14 },
          pressed && { transform: [{ scale: 0.94 }] },
        ]}
        onPress={() => (session ? router.push('/observe') : signInFirst('Sign in to add a sighting. It only takes a minute.', '/observe'))}
        accessibilityRole="button"
        accessibilityLabel="Add a sighting"
      >
        <Feather name="plus" size={28} color={c.onPrimary} />
      </Pressable>
    </View>
  );
}

const BAR = 66; // tab row + top padding

/** Library · discoveries · learn · games · avatar, evenly spaced; the navy + floats above the bar (design/refs look). */
function TabBar({ state, navigation }: TabBarProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const tab = (route: Route, i: number) => {
    const focused = state.index === i;
    const color = focused ? c.ink : c.inkFaint;
    const onPress = () => {
      const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
    };
    const { icon, label } = TABS[route.name];
    let content = <Feather name={icon} size={22} color={color} />;
    if (route.name === 'profile' && session) {
      content = session.user.avatar_url ? (
        <Image source={{ uri: mediaUrl(session.user.avatar_url) }} style={[styles.avatar, focused && { borderColor: c.ink }]} />
      ) : (
        <View style={[styles.avatar, { backgroundColor: c.tint }, focused && { borderColor: c.ink }]}>
          <Text style={[styles.avatarText, { color: c.tintIcon }]}>{session.user.display_name[0]?.toUpperCase()}</Text>
        </View>
      );
    }
    return (
      <Pressable
        key={route.key}
        style={styles.tab}
        onPress={onPress}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
      >
        {content}
      </Pressable>
    );
  };

  // Five tabs share the bar evenly; "add a sighting" floats above it (see TabsLayout), so nothing sits off-centre.
  return (
    <View style={[styles.bar, { backgroundColor: c.surface, paddingBottom: Math.max(insets.bottom, 12) }]}>
      {state.routes.map((r, i) => tab(r, i))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    shadowColor: '#17144B',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 56 },
  fab: {
    position: 'absolute',
    right: 18,
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#17144B',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: font.bold, fontSize: 13 },
});
