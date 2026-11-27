import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteDownload, downloadEpisode, getAllDownloadedEpisodes } from '../services/storageService';
import { isAndroid } from '../services/android';
import type { DownloadConnection } from '../services/android';
import type { Preferences } from '../services/preferences';
import type { Episode } from '../types';

export function useDownloadStorage() {
  const [downloadsReady, setDownloadsReady] = useState(false);
  const [downloadedEpisodes, setDownloadedEpisodes] = useState<Episode[]>([]);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [finishedIds, setFinishedIds] = useState<Set<string>>(new Set());
  const active = useRef(new Map<string, { discard: boolean }>());
  const removals = useRef(new Map<string, Promise<void>>());
  const latestRead = useRef(0);

  const refreshDownloads = useCallback(async () => {
    const read = ++latestRead.current;
    try {
      const episodes = await getAllDownloadedEpisodes();
      if (read === latestRead.current) setDownloadedEpisodes(episodes);
    } catch (error) {
      console.error(error);
    } finally {
      if (read === latestRead.current) setDownloadsReady(true);
    }
  }, []);

  // Load downloads on mount
  useEffect(() => {
    void refreshDownloads();
  }, [refreshDownloads]);

  const removeDownload = useCallback((id: string) => {
    const existing = removals.current.get(id);
    if (existing) return existing;
    const removal = deleteDownload(id).then(async () => {
      if (isAndroid) await refreshDownloads();
      else setDownloadedEpisodes(previous => previous.filter(episode => episode.id !== id));
    }).finally(() => { removals.current.delete(id); });
    removals.current.set(id, removal);
    return removal;
  }, [refreshDownloads]);

  const removeFinished = useCallback(async (id: string) => {
    try {
      await removeDownload(id);
      return true;
    } catch {
      console.warn('Could not remove a finished download.');
      return false;
    }
  }, [removeDownload]);

  const finishDownload = useCallback((id: string) => {
    setFinishedIds(previous => previous.has(id) ? previous : new Set([...previous, id]));
    if (isAndroid) return; // The playback service owns native cleanup.
    const attempt = active.current.get(id);
    if (attempt) attempt.discard = true;
    else void removeFinished(id);
  }, [removeFinished]);

  const forgetUnqueuedCompletions = useCallback((queue: Episode[]) => {
    setFinishedIds(previous => {
      if (!previous.size) return previous;
      const stillQueued = new Set(queue.filter(episode => previous.has(episode.id)).map(episode => episode.id));
      return stillQueued.size === previous.size ? previous : stillQueued;
    });
  }, []);

  const startDownload = useCallback(async (episode: Episode) => {
    if (active.current.has(episode.id)) return;
    const attempt = { discard: false };
    active.current.set(episode.id, attempt);
    setDownloadingIds(new Set(active.current.keys()));
    try {
      await removals.current.get(episode.id)?.catch(() => {});
      await downloadEpisode(episode);
      if (isAndroid) await refreshDownloads();
      else if (!attempt.discard || !await removeFinished(episode.id)) {
        setDownloadedEpisodes(previous => [...previous.filter(item => item.id !== episode.id), episode]);
      }
    } finally {
      active.current.delete(episode.id);
      setDownloadingIds(new Set(active.current.keys()));
    }
  }, [refreshDownloads, removeFinished]);

  return {
    downloadsReady, downloadedEpisodes, downloadingIds, startDownload, removeDownload,
    refreshDownloads, finishDownload, finishedIds, forgetUnqueuedCompletions,
  };
}

interface DownloadRequest {
  episode: Episode;
  automatic: boolean;
  approvedOn?: DownloadConnection;
}

interface DownloadPolicyOptions {
  connection: DownloadConnection | null;
  ready: boolean;
  queue: Episode[];
  preferences: Preferences;
  storage: ReturnType<typeof useDownloadStorage>;
  onError: (message: string | null) => void;
}

export function useDownloadPolicy({ connection, ready, queue, preferences, storage, onError }: DownloadPolicyOptions) {
  const { cellularDownload, autoDownloadQueued } = preferences;
  const { downloadsReady, downloadedEpisodes, downloadingIds, startDownload, finishedIds, forgetUnqueuedCompletions } = storage;
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const [dialogClosures, setDialogClosures] = useState(0);
  const [pending, setPending] = useState<DownloadRequest | null>(null);
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === 'visible');
    const onClose = (event: Event) => {
      if (event.target instanceof HTMLDialogElement) setDialogClosures(count => count + 1);
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('close', onClose, true);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('close', onClose, true);
    };
  }, []);

  useEffect(() => { attempted.current.clear(); }, [connection]);
  useEffect(() => {
    if (ready) forgetUnqueuedCompletions(queue);
  }, [ready, queue, finishedIds, forgetUnqueuedCompletions]);

  const requestDownload = useCallback((episode: Episode) => {
    setPending(current => current ?? { episode, automatic: false });
  }, []);

  const start = useCallback(({ episode, automatic }: DownloadRequest) => {
    attempted.current.add(episode.id);
    if (!automatic) onError(null);
    void startDownload(episode).catch(error => {
      console.error('Download failed', error);
      if (!automatic) onError('Could not download this episode.');
    });
  }, [startDownload, onError]);

  const transport = connection?.transport;
  const ask = transport === 'cellular' && cellularDownload === 'ask';
  const blocked = transport === 'cellular' && cellularDownload === 'no';
  const pendingEligible = pending && (!pending.automatic || (
    autoDownloadQueued && !finishedIds.has(pending.episode.id) && queue.some(episode => episode.id === pending.episode.id)
  ));
  const confirmation = ready && downloadsReady && visible && ask && pendingEligible && pending.approvedOn !== connection
    ? pending.episode : null;

  useEffect(() => {
    if (!ready || !downloadsReady || !transport) return;
    const unavailable = (episode: Episode) => downloadingIds.has(episode.id) || downloadedEpisodes.some(item => item.id === episode.id);
    const denial = blocked ? 'Cellular downloads are turned off in Settings.'
      : transport === 'offline' ? 'Connect to the internet to download this episode.' : null;

    if (pending) {
      if (!pendingEligible || unavailable(pending.episode)) {
        setPending(null);
      } else if (denial) {
        if (!pending.automatic) onError(denial);
        setPending(null);
      } else if (!ask || pending.approvedOn === connection) {
        start(pending);
        setPending(null);
      } else if (pending.automatic && !visible) {
        setPending(null);
      }
      return;
    }

    if (!autoDownloadQueued || denial || downloadingIds.size) return;
    if (ask && (!visible || document.querySelector('dialog:modal'))) return;
    const next = queue.find(episode => !finishedIds.has(episode.id) && !attempted.current.has(episode.id) && !unavailable(episode));
    if (!next) return;
    const request = { episode: next, automatic: true };
    if (ask) setPending(current => current ?? request);
    else start(request);
  }, [ready, downloadsReady, connection, transport, ask, blocked, pending, pendingEligible, autoDownloadQueued,
    visible, dialogClosures, queue, downloadingIds, downloadedEpisodes, finishedIds, start, onError]);

  const answerConfirmation = (allow: boolean) => {
    if (!pending || !confirmation || !connection) return;
    if (!allow && queue.some(episode => episode.id === pending.episode.id)) {
      attempted.current.add(pending.episode.id);
    }
    // Recheck the policy before starting, including any connection or settings change since the prompt opened.
    setPending(allow ? { ...pending, approvedOn: connection } : null);
  };

  return { requestDownload, confirmation, answerConfirmation };
}
