import { useCallback, useEffect, useRef, useState } from 'react';
import type { Episode } from '../types';
import { AndroidDownloads, AndroidPlayback } from '../services/android';
import type { AndroidPlaybackState } from '../services/android';
import { androidPlaybackOpen, androidPlaybackQueue, androidPlaybackTrack, applyAndroidPlayback } from '../services/androidPlaybackState';
import { resumePoint } from '../services/driveSync';
import type { ResumePoint } from '../services/driveSync';
import { formatTime } from './usePodcastPlayer';
import type { UsePodcastPlayerProps } from './usePodcastPlayer';

type Command = Omit<Parameters<typeof AndroidPlayback.control>[0], 'profile'>;

export function useAndroidPodcastPlayer({
  profile, ready, state, updateState, remoteSession, skipBackwardSeconds, skipForwardSeconds,
  autoRemoveFinishedDownloads, finishDownload, refreshDownloads,
}: UsePodcastPlayerProps) {
  const [playback, setPlayback] = useState<AndroidPlaybackState | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [remoteOffer, setRemoteOffer] = useState<ResumePoint | null>(null);
  const [acknowledgedRevision, setAcknowledgedRevision] = useState(0);
  const storage = useRef({ state, updateState });
  const active = useRef(false);
  const operations = useRef(Promise.resolve());
  const saving = useRef(false);
  const lastCleanupRevision = useRef(0);

  useEffect(() => {
    storage.current = { state, updateState };
  }, [state, updateState]);
  useEffect(() => { setRemoteOffer(remoteSession); }, [remoteSession]);

  const request = useCallback((command: Command | (() => Command)) => {
    const run = async () => {
      if (!active.current) return;
      const snapshot = await AndroidPlayback.control({ ...(typeof command === 'function' ? command() : command), profile });
      if (!active.current) return;
      const cleaned = snapshot.changes.filter(change => change.downloadCleanup && (change.revision ?? 0) > lastCleanupRevision.current);
      if (cleaned.length) {
        lastCleanupRevision.current = snapshot.revision;
        for (const change of cleaned) finishDownload(change.episode.id);
        void refreshDownloads();
      }
      setPlayback(snapshot);
      setConnectionError(false);
      if (saving.current || !snapshot.changes.length) return;
      saving.current = true;
      void storage.current.updateState(previous => applyAndroidPlayback(previous, snapshot), snapshot.urgent, !snapshot.urgent)
        .then(async saved => {
          if (saved && active.current) {
            await AndroidPlayback.control({ profile, action: 'acknowledge', revision: snapshot.revision });
            if (active.current && snapshot.changes.some(change => change.selected || change.finished)) {
              setAcknowledgedRevision(snapshot.revision);
            }
          }
        })
        .catch(() => { /* The service retains these changes for the next reconciliation. */ })
        .finally(() => { saving.current = false; });
    };
    operations.current = operations.current.then(run).catch(() => {
      if (active.current) setConnectionError(true);
    });
    return operations.current;
  }, [profile, finishDownload, refreshDownloads]);

  const open = useCallback(() => request(() => androidPlaybackOpen(storage.current.state)), [request]);

  useEffect(() => {
    if (!ready) return;
    active.current = true;
    void open();

    let pending = false;
    const poll = () => {
      if (pending || document.visibilityState !== 'visible') return;
      pending = true;
      void request({ action: 'snapshot' }).finally(() => { pending = false; });
    };
    const timer = window.setInterval(poll, 1000);
    const resume = () => { void request({ action: 'snapshot' }).then(refreshDownloads); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') resume();
    };
    const listener = AndroidDownloads.addListener('resume', resume);
    void listener.catch(() => { /* Visibility changes also refresh downloads. */ });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active.current = false;
      window.clearInterval(timer);
      void listener.then(handle => handle.remove()).catch(() => {});
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [open, ready, request, refreshDownloads]);

  const { queue, subscriptions, playbackProgress } = state;
  useEffect(() => {
    if (ready) void request({ action: 'preferences', skipBackwardSeconds, skipForwardSeconds, autoRemoveFinishedDownloads });
  }, [ready, request, skipBackwardSeconds, skipForwardSeconds, autoRemoveFinishedDownloads]);

  useEffect(() => {
    if (ready) void request(() => ({ action: 'queue', queue: androidPlaybackQueue(storage.current.state) }));
  }, [ready, queue, subscriptions, playbackProgress, acknowledgedRevision, request]);

  const currentEpisode = playback?.episode ?? null;
  const playingPodcast = state.subscriptions.find(p => p.feedUrl === currentEpisode?.podcastId) ?? null;
  const offer = remoteOffer ?? resumePoint(state);
  const togglePlay = useCallback(() => {
    setRemoteOffer(null);
    void request({ action: 'toggle' });
  }, [request]);
  const playEpisode = useCallback((episode: Episode) => {
    if (currentEpisode?.id === episode.id) {
      togglePlay();
    } else {
      setRemoteOffer(null);
      void request({ action: 'select', track: androidPlaybackTrack(storage.current.state, episode), autoplay: true });
    }
  }, [currentEpisode, request, togglePlay]);
  const skip = useCallback((seconds: number) => {
    setRemoteOffer(null);
    void request({ action: 'skip', time: seconds });
  }, [request]);
  const seek = (time: number) => {
    setRemoteOffer(null);
    void request({ action: 'seek', time });
  };
  const continueListening = () => {
    if (!offer) return;
    setRemoteOffer(null);
    void request({ action: 'select', track: androidPlaybackTrack(state, offer.episode, offer.time), autoplay: true });
  };
  const retry = () => {
    if (connectionError) void open();
    else togglePlay();
  };

  return {
    currentEpisode, playingPodcast, offer, hasRemoteOffer: !!remoteOffer, continueListening,
    isPlaying: playback?.playing ?? false,
    currentTime: playback?.time ?? 0,
    duration: playback?.duration ?? 0,
    playbackReady: ready && playback !== null,
    playbackError: connectionError || (playback?.error ?? false),
    retry, togglePlay, skip, seek, formatTime, playEpisode,
    audioRef: null, audioEvents: {},
  };
}
