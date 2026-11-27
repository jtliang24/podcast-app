import { useCallback, useSyncExternalStore } from 'react';

/** Whether the CSS media `query` matches now; updates when it changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const list = matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}
