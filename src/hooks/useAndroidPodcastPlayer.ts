import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, Episode } from '../types';
import { AndroidPlayback } from '../services/android';
import type { AndroidPlaybackState, AndroidTrack } from '../services/android';
import { applyAndroidPlayback } from '../services/androidPlaybackState';
import { resumePoint } from '../services/driveSync';
import type { ResumePoint } from '../services/driveSync';
import { formatTime } from './usePodcastPlayer';
import type { UsePodcastPlayerProps } from './usePodcastPlayer';

type Command = Omit<Parameters<typeof AndroidPlayback.control>[0], 'profile'>;

function track(state: AppState, episode: Episode, time = state.playbackProgress[episode.audioUrl]?.currentTime ?? 0): AndroidTrack {
  const podcast = state.subscriptions.find(p => p.feedUrl === episode.podcastId);
  return { episode, time, podcastTitle: podcast?.title, artworkUrl: podcast?.artworkUrl };
}

export function useAndroidPodcastPlayer({ profile, ready, state, updateState, remoteSession }: UsePodcastPlayerProps) {
  const [playback, setPlayback] = useState<AndroidPlaybackState | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [remoteOffer, setRemoteOffer] = useState<ResumePoint | null>(null);
  const storage = useRef({ state, updateState });
  const active = useRef(false);
  const operations = useRef(Promise.resolve());
  const saving = useRef(false);

  useEffect(() => { storage.current = { state, updateState }; }, [state, updateState]);
  useEffect(() => { setRemoteOffer(remoteSession); }, [remoteSession]);

  const request = useCallback((command: Command) => {
    const run = async () => {
      if (!active.current) return;
      const snapshot = await AndroidPlayback.control({ ...command, profile });
      if (!active.current) return;
      setPlayback(snapshot);
      setConnectionError(false);
      if (saving.current || !snapshot.changes.length) return;
      saving.current = true;
      void storage.current.updateState(previous => applyAndroidPlayback(previous, snapshot), snapshot.urgent)
        .then(async saved => {
          if (saved !== false && active.current) {
            await AndroidPlayback.control({ profile, action: 'acknowledge', revision: snapshot.revision });
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
    const state = storage.current.state;
    const point = resumePoint(state);
    return request({
      action: 'open',
      track: point ? track(state, point.episode, point.time) : undefined,
      updated: point ? state.playbackProgress[point.episode.audioUrl]?.lastUpdated : undefined,
      queue: state.queue.map(episode => track(state, episode)),
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
    if (ready) {
      const current = storage.current.state;
      void request({ action: 'queue', queue: queue.map(episode => track(current, episode)) });
    }
  }, [ready, queue, subscriptions, playbackProgress, request]);

  const currentEpisode = playback?.episode ?? null;
  const playingPodcast = state.subscriptions.find(p => p.feedUrl === currentEpisode?.podcastId) ?? null;
  const offer = remoteOffer ?? resumePoint(state);
  const togglePlay = useCallback(() => {
    setRemoteOffer(null);
    void request({ action: 'toggle' });
  }, [request]);
  const playEpisode = useCallback((episode: Episode) => {
    if (currentEpisode?.audioUrl === episode.audioUrl) {
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
  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRemoteOffer(null);
    void request({ action: 'seek', time: Number(event.target.value) });
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
    retry, togglePlay, skip, handleSeek, formatTime, playEpisode,
    audioRef: null, audioEvents: {},
  };
}
