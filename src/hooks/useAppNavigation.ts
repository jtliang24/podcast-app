import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AndroidNavigation, isAndroid } from '../services/android';
import type { Episode, Podcast } from '../types';

export type Page =
  | { kind: 'home' | 'downloads' | 'new-releases' | 'queue' }
  | { kind: 'search'; query: string; results?: Podcast[] }
  | { kind: 'podcast'; podcast: Podcast; episodes?: Episode[]; visibleCount: number; error?: string }
  | { kind: 'episode'; episode: Episode; podcast: Podcast | null };

interface Entry {
  id: string;
  depth: number;
  page: Page;
  searchInput: string;
  windowScroll: number;
  contentScroll: number;
}

function createEntry(page: Page, depth: number, searchInput: string): Entry {
  return { id: crypto.randomUUID(), depth, page, searchInput, windowScroll: 0, contentScroll: 0 };
}

function activeDialog() {
  return document.activeElement?.closest<HTMLDialogElement>('dialog:modal')
    ?? document.querySelector<HTMLDialogElement>('dialog:modal');
}

function cancelDialog(dialog: HTMLDialogElement & { requestClose?: () => void }) {
  if (dialog.requestClose) {
    dialog.requestClose();
  } else if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) {
    dialog.close();
  }
}

export function useAppNavigation(ready: boolean) {
  const [root] = useState(() => createEntry({ kind: 'home' }, 0, ''));
  const [position, setPosition] = useState({ entry: root, visit: 0 });
  const active = useRef(position);
  // Keep page data in memory. Browser history only needs to identify each entry.
  const entries = useRef([root]);
  const mounted = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const queueButton = useRef<HTMLButtonElement>(null);
  const restoreQueueFocus = useRef(false);
  const backPending = useRef(false);
  const queuedBacks = useRef(0);
  const [showLibrary, setDrawer] = useState(false);
  const drawerOpen = useRef(false);
  const androidBackEnabled = useRef(false);

  const setShowLibrary = useCallback((open: boolean) => {
    drawerOpen.current = open;
    setDrawer(open);
  }, []);

  const saveCurrentEntry = useCallback((searchInput?: string) => {
    const { entry } = active.current;
    entries.current[entry.depth] = {
      ...entry,
      searchInput: searchInput ?? entry.searchInput,
      windowScroll: window.scrollY,
      contentScroll: contentRef.current?.scrollTop ?? 0,
    };
  }, []);

  const activate = useCallback((entry: Entry) => {
    active.current = { entry, visit: active.current.visit + 1 };
    setPosition(active.current);
    setShowLibrary(false);
  }, [setShowLibrary]);

  const goTo = useCallback((page: Page) => {
    if (backPending.current) return;
    const previous = active.current.entry;
    const entry = createEntry(page, previous.depth + 1, page.kind === 'search' ? page.query : previous.searchInput);
    const previousQuery = page.kind === 'search' && previous.page.kind === 'search' ? previous.page.query : undefined;
    saveCurrentEntry(previousQuery);
    history.pushState({ ...history.state, podcastPage: { id: entry.id, depth: entry.depth } }, '');
    entries.current.splice(entry.depth, entries.current.length, entry);
    activate(entry);
  }, [activate, saveCurrentEntry]);

  const isCurrentVisit = useCallback((visit: number) => mounted.current && active.current.visit === visit, []);

  const updateEntry = useCallback((change: Partial<Pick<Entry, 'page' | 'searchInput'>>) => {
    const { entry, visit } = active.current;
    const updated = { ...entry, ...change };
    entries.current[entry.depth] = updated;
    active.current = { entry: updated, visit };
    setPosition(active.current);
  }, []);

  const setSearchInput = useCallback((searchInput: string) => updateEntry({ searchInput }), [updateEntry]);

  const updatePage = useCallback((visit: number, page: Page) => {
    if (isCurrentVisit(visit)) updateEntry({ page });
  }, [isCurrentVisit, updateEntry]);

  const back = useCallback(() => {
    const dialog = activeDialog();
    if (dialog) {
      flushSync(() => cancelDialog(dialog));
      return;
    }
    if (ready && drawerOpen.current && !matchMedia('(min-width: 768px)').matches) {
      setShowLibrary(false);
      return;
    }
    if (!ready || active.current.entry.depth === 0) return;
    if (backPending.current) {
      queuedBacks.current++;
      return;
    }
    backPending.current = true;
    history.back();
  }, [ready, setShowLibrary]);

  useLayoutEffect(() => {
    mounted.current = true;
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    history.replaceState({ ...history.state, podcastPage: { id: root.id, depth: 0 } }, '');

    const onPop = (event: PopStateEvent) => {
      const marker = event.state?.podcastPage;
      const match = entries.current[marker?.depth];
      const destination = match && match.id === marker?.id ? match : entries.current[0];
      const previous = active.current.entry;
      if (destination.id !== previous.id) {
        saveCurrentEntry();
        restoreQueueFocus.current = previous.page.kind === 'queue' && destination.depth < previous.depth;
        flushSync(() => activate(destination));
      }
      backPending.current = false;
      // history.back() completes asynchronously. Wait for the new entry before the next Back.
      if (queuedBacks.current > 0 && destination.depth > 0) {
        queuedBacks.current--;
        backPending.current = true;
        history.back();
      } else {
        queuedBacks.current = 0;
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      history.scrollRestoration = previousRestoration;
      mounted.current = false;
    };
  }, [root, activate, saveCurrentEntry]);

  const { entry, visit } = position;
  useLayoutEffect(() => {
    const current = active.current.entry;
    if (contentRef.current) contentRef.current.scrollTop = current.contentScroll;
    window.scrollTo(0, current.windowScroll);
    if (restoreQueueFocus.current) queueButton.current?.focus({ preventScroll: true });
    restoreQueueFocus.current = false;
  }, [visit]);

  const syncAndroidBack = useCallback(() => {
    if (!isAndroid) return;
    const canGoBack = ready && (active.current.entry.depth > 0
      || (drawerOpen.current && !matchMedia('(min-width: 768px)').matches));
    const enabled = canGoBack || !!activeDialog();
    if (androidBackEnabled.current === enabled) return;
    androidBackEnabled.current = enabled;
    void AndroidNavigation.setBackEnabled({ enabled }).catch(console.error);
  }, [ready]);

  useLayoutEffect(() => {
    if (!isAndroid) return;
    const observer = new MutationObserver(syncAndroidBack);
    observer.observe(document.body, { subtree: true, childList: true, attributeFilter: ['open'] });
    window.addEventListener('resize', syncAndroidBack);
    window.addEventListener('podcastBack', back);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncAndroidBack);
      window.removeEventListener('podcastBack', back);
    };
  }, [back, syncAndroidBack]);

  useLayoutEffect(syncAndroidBack, [syncAndroidBack, visit, showLibrary]);
  useLayoutEffect(() => () => {
    if (androidBackEnabled.current) {
      androidBackEnabled.current = false;
      void AndroidNavigation.setBackEnabled({ enabled: false }).catch(console.error);
    }
  }, []);

  return {
    page: entry.page, previousPage: entries.current[entry.depth - 1]?.page,
    searchInput: entry.searchInput, visit, contentRef, queueButton,
    showLibrary, setShowLibrary, setSearchInput, goTo, back, isCurrentVisit, updatePage,
  };
}
