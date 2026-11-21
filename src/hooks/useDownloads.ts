import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteDownload, downloadEpisode, getAllDownloadedEpisodes } from '../services/storageService';
import type { DownloadConnection } from '../services/android';
import type { Preferences } from '../services/preferences';
import type { Episode } from '../types';
import { useDownloadConnection } from './useDownloadConnection';

export function useDownloadStorage() {
  const [downloadsReady, setDownloadsReady] = useState(false);
  const [downloadedEpisodes, setDownloadedEpisodes] = useState<Episode[]>([]);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const active = useRef(new Set<string>());

  // Load downloads on mount
  useEffect(() => {
    let mounted = true;
    void getAllDownloadedEpisodes().then(episodes => {
      if (mounted) setDownloadedEpisodes(episodes);
    }).catch(console.error).finally(() => {
      if (mounted) setDownloadsReady(true);
    });
    return () => { mounted = false; };
  }, []);

  const startDownload = useCallback(async (episode: Episode) => {
    if (active.current.has(episode.id)) return;
    active.current.add(episode.id);
    setDownloadingIds(new Set(active.current));
    try {
      await downloadEpisode(episode);
      setDownloadedEpisodes(previous => [...previous.filter(item => item.id !== episode.id), episode]);
    } finally {
      active.current.delete(episode.id);
      setDownloadingIds(new Set(active.current));
    }
  }, []);

  const removeDownload = useCallback(async (id: string) => {
    await deleteDownload(id);
    setDownloadedEpisodes(previous => previous.filter(episode => episode.id !== id));
  }, []);

  return { downloadsReady, downloadedEpisodes, downloadingIds, startDownload, removeDownload };
}

interface DownloadRequest {
  episode: Episode;
  automatic: boolean;
  approvedOn?: DownloadConnection;
}

interface DownloadPolicyOptions {
  ready: boolean;
  queue: Episode[];
  preferences: Preferences;
  storage: ReturnType<typeof useDownloadStorage>;
  onError: (message: string | null) => void;
}

export function useDownloadPolicy({ ready, queue, preferences, storage, onError }: DownloadPolicyOptions) {
  const { cellularDownload, autoDownloadQueued } = preferences;
  const { downloadsReady, downloadedEpisodes, downloadingIds, startDownload } = storage;
  const connection = useDownloadConnection();
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
    autoDownloadQueued && queue.some(episode => episode.id === pending.episode.id)
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
    const next = queue.find(episode => !attempted.current.has(episode.id) && !unavailable(episode));
    if (!next) return;
    const request = { episode: next, automatic: true };
    if (ask) setPending(current => current ?? request);
    else start(request);
  }, [ready, downloadsReady, connection, transport, ask, blocked, pending, pendingEligible, autoDownloadQueued,
    visible, dialogClosures, queue, downloadingIds, downloadedEpisodes, start, onError]);

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
