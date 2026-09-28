import { router, type Href } from 'expo-router';

/** Leave a modal: back if there's a screen underneath (not the case after a reload or deep link), else home. */
export function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * ACC-03: ask for an account only when an action needs one. `why` is shown on the sign-in screen;
 * `next` (a path, may carry a query) opens once signed in, so the person carries on where they were.
 */
export function signInFirst(why: string, next?: string) {
  router.push({ pathname: '/sign-in', params: next ? { why, next } : { why } });
}

/** After signing in: carry on to `next`, or just close the sign-in screen. */
export function afterSignIn(next?: string) {
  if (next?.startsWith('/')) router.replace(next as Href);
  else close();
}
