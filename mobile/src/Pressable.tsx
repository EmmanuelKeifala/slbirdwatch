import { forwardRef } from 'react';
import { Pressable as RNPressable, type PressableProps, type View } from 'react-native';

/**
 * Every tappable in the app dims while pressed, so taps always feel acknowledged. (No haptics: a buzz on
 * every tap was too much.) A style function handles its own pressed look; plain styles get the default dim.
 */
export const Pressable = forwardRef<View, PressableProps>(function Pressable({ style, ...rest }, ref) {
  return (
    <RNPressable
      ref={ref}
      style={(state) => (typeof style === 'function' ? style(state) : [style, state.pressed && { opacity: 0.6 }])}
      {...rest}
    />
  );
});
