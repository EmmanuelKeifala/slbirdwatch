import { forwardRef, useState } from 'react';
import { Platform, Pressable as RNPressable, StyleSheet, type PressableProps, type View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);
const SPRING = { damping: 18, stiffness: 420, mass: 0.6 };
const android = Platform.OS === 'android';

/**
 * Every tappable in the app answers the finger: it springs down slightly while held (on the UI thread) and
 * back on release. Android adds its own ripple, clipped to rounded corners and round on icon buttons;
 * iOS dims instead. A style function still sets its own pressed look. (No haptics: a buzz on every tap was
 * too much.) Anything already transformed (rotated, shifted) skips the spring so its transform isn't replaced.
 */
export const Pressable = forwardRef<View, PressableProps>(function Pressable(
  { style, onPressIn, onPressOut, android_ripple, ...rest },
  ref,
) {
  const [pressed, setPressed] = useState(false);
  const scale = useSharedValue(1);
  const springy = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const own = typeof style === 'function' ? style({ pressed, hovered: false }) : [style, !android && pressed && { opacity: 0.6 }];
  const base = StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false, hovered: false }) : style) ?? {};
  const spring = !base.transform;
  // bare icon buttons (they carry a hitSlop) get the round borderless ripple; rows and cards a clipped one
  const icon = !!rest.hitSlop && !base.backgroundColor && !base.borderWidth;

  return (
    <AnimatedPressable
      ref={ref}
      style={[own, android && !!base.borderRadius && styles.clip, spring && springy]}
      android_ripple={android_ripple ?? { color: 'rgba(23,20,75,0.12)', borderless: icon, foreground: !icon }}
      onPressIn={(e) => {
        setPressed(true);
        if (spring) scale.value = withSpring(0.97, SPRING);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        if (spring) scale.value = withSpring(1, SPRING);
        onPressOut?.(e);
      }}
      {...rest}
    />
  );
});

const styles = StyleSheet.create({ clip: { overflow: 'hidden' } });
