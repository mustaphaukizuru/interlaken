import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
};

/** Reactive navigator.onLine (BACKLOG P4-9). Defaults to online when unknown. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => (typeof navigator === 'undefined' ? true : navigator.onLine), () => true);
}
