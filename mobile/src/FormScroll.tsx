import { createContext, useContext, useEffect, useRef, useState, type Ref } from 'react';
import { Keyboard, ScrollView, TextInput, type ScrollViewProps, type View } from 'react-native';

import { space } from '@/theme';

const BringToTop = createContext<((target: View | null) => void) | null>(null);
type Box = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void };

/**
 * The scroll view for any screen with a text box. Plain React Native, so it works in Expo Go: while the keyboard
 * is up it adds room below the content and scrolls the focused input clear of the keyboard (Android edge-to-edge
 * doesn't reliably resize the window). Also re-checks after taps, since switching fields with the keyboard already
 * open fires no keyboard event.
 */
export function FormScroll({ ref, contentContainerStyle, onScroll, onTouchEnd, ...p }: ScrollViewProps & { ref?: Ref<ScrollView> }) {
  const own = useRef<ScrollView | null>(null);
  const offset = useRef(0);
  const keyboardTop = useRef<number | null>(null); // screen y of the keyboard's top edge while it's up
  const lift = useRef<View | null>(null); // a search box asked to go to the top
  const [room, setRoom] = useState(0);

  const setRef = (node: ScrollView | null) => {
    own.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  // Scroll so the focused input (or the search box that asked) is in view above the keyboard.
  const reveal = () => {
    const scroll = own.current;
    const top = keyboardTop.current;
    const target = (lift.current ?? TextInput.State.currentlyFocusedInput()) as unknown as Box | null;
    if (!scroll || top === null || !target) return;
    const toTop = !!lift.current;
    lift.current = null;
    (scroll as unknown as Box).measureInWindow((_sx, scrollY) =>
      target.measureInWindow((_x, y, _w, h) => {
        let delta = 0;
        if (toTop) delta = y - scrollY - space.l; // search box at the top, its results below
        else if (y + h > top - space.xl) delta = y + h - (top - space.xl); // just clear of the keyboard
        else if (y < scrollY) delta = y - scrollY - space.l; // scrolled off the top
        if (delta) scroll.scrollTo({ y: Math.max(0, offset.current + delta), animated: true });
      }),
    );
  };
  const later = () => setTimeout(reveal, 60);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      setRoom(e.endCoordinates.height);
      setTimeout(reveal, 60); // after the extra room is laid out
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      setRoom(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const bringToTop = (target: View | null) => {
    lift.current = target;
    if (keyboardTop.current !== null) later(); // keyboard already up: no event will come
  };

  return (
    <BringToTop.Provider value={bringToTop}>
      <ScrollView
        ref={setRef}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        {...p}
        contentContainerStyle={[contentContainerStyle, room ? { paddingBottom: room + space.xxl } : null]}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
          onScroll?.(e);
        }}
        onTouchEnd={(e) => {
          if (keyboardTop.current !== null) setTimeout(reveal, 250); // moved to another field
          onTouchEnd?.(e);
        }}
      />
    </BringToTop.Provider>
  );
}

/** For inputs with results below them: call with the input's wrapper on focus. No-op outside a FormScroll. */
export const useBringToTop = () => useContext(BringToTop) ?? (() => {});
