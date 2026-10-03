import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * `false` during SSR and the initial client render, `true` once hydrated: the React-recommended,
 * mismatch-free way to gate client-only rendering, such as a date in the browser's time zone
 * (the server's can put it on a different day).
 */
export function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
