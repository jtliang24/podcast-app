import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, Episode } from '../types';
import { AndroidPlayback } from '../services/android';
import type { AndroidPlaybackState, AndroidTrack } from '../services/android';
import { applyAndroidPlayback } from '../services/androidPlaybackState';
import { resumePoint } from '../services/driveSync';
import type { ResumePoint } from '../services/driveSync';
import { formatTime } from './usePodcastPlayer';
import type { UsePodcastPlayerProps } from './usePodcastPlayer';
import { orderedQueue } from '../services/playbackQueue';

type Command = Omit<Parameters<typeof AndroidPlayback.control>[0], 'profile'>;

function queueTracks(state: AppState) {
  return orderedQueue(state.queue).map(episode => track(state, episode));
}

function track(state: AppState, episode: Episode, time = state.playbackProgress[episode.audioUrl]?.currentTime ?? 0): AndroidTrack {
  const podcast = state.subscriptions.find(p => p.feedUrl === episode.podcastId);
  return { episode, time, podcastTitle: podcast?.title, artworkUrl: podcast?.artworkUrl };
}

export function useAndroidPodcastPlayer({
  profile, ready, state, updateState, remoteSession, skipBackwardSeconds, skipForwardSeconds,
}: UsePodcastPlayerProps) {
  const [playback, setPlayback] = useState<AndroidPlaybackState | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [remoteOffer, setRemoteOffer] = useState<ResumePoint | null>(null);
  const [acknowledgedRevision, setAcknowledgedRevision] = useState(0);
  const storage = useRef({ state, updateState, skipBackwardSeconds, skipForwardSeconds });
  const active = useRef(false);
  const operations = useRef(Promise.resolve());
  const saving = useRef(false);

  useEffect(() => {
    storage.current = { state, updateState, skipBackwardSeconds, skipForwardSeconds };
  }, [state, updateState, skipBackwardSeconds, skipForwardSeconds]);
  useEffect(() => { setRemoteOffer(remoteSession); }, [remoteSession]);

  const request = useCallback((command: Command | (() => Command)) => {
    const run = async () => {
      if (!active.current) return;
      const snapshot = await AndroidPlayback.control({ ...(typeof command === 'function' ? command() : command), profile });
      if (!active.current) return;
      setPlayback(snapshot);
      setConnectionError(false);
      if (saving.current || !snapshot.changes.length) return;
      saving.current = true;
      void storage.current.updateState(previous => applyAndroidPlayback(previous, snapshot), snapshot.urgent, !snapshot.urgent)
        .then(async saved => {
          if (saved !== false && active.current) {
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
  }, [profile]);

  const open = useCallback(() => {
    const { state, skipBackwardSeconds, skipForwardSeconds } = storage.current;
    const point = resumePoint(state);
    return request({
      action: 'open',
      track: point ? track(state, point.episode, point.time) : undefined,
      updated: point ? state.playbackProgress[point.episode.audioUrl]?.lastUpdated : undefined,
      queue: queueTracks(state),
      skipBackwardSeconds,
      skipForwardSeconds,
    });
  }, [request]);

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
    document.addEventListener('visibilitychange', poll);
    return () => {
      active.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [open, ready, request]);

  const { queue, subscriptions, playbackProgress } = state;
  useEffect(() => {
    if (ready) void request({ action: 'seekIncrements', skipBackwardSeconds, skipForwardSeconds });
  }, [ready, request, skipBackwardSeconds, skipForwardSeconds]);

  useEffect(() => {
    if (ready) void request(() => ({ action: 'queue', queue: queueTracks(storage.current.state) }));
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
      void request({ action: 'select', track: track(storage.current.state, episode), autoplay: true });
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
    void request({ action: 'select', track: track(state, offer.episode, offer.time), autoplay: true });
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
    playbackError: connectionError || (playback?.error ?? false),
    retry, togglePlay, skip, seek, formatTime, playEpisode,
    audioRef: null, audioEvents: {},
  };
}
