import { useState, useRef, useEffect, useCallback } from 'react';
import type { Episode, AppState, SkipInterval } from '../types';
import { getAudioBlob } from '../services/storageService';
import { resumePoint } from '../services/driveSync';
import type { ResumePoint } from '../services/driveSync';
import type { StateUpdate } from '../services/profileChanges';
import { recordPodcastPlay } from '../services/subscriptionSort';
import { nextEpisode, removeQueuedEpisode } from '../services/playbackQueue';

export interface UsePodcastPlayerProps {
  profile: string;
  state: AppState;
  ready: boolean;
  skipBackwardSeconds: SkipInterval;
  skipForwardSeconds: SkipInterval;
  autoRemoveFinishedDownloads: boolean;
  finishDownload: (id: string) => void;
  refreshDownloads: () => Promise<void>;
  updateState: (update: StateUpdate, urgent?: boolean, routine?: boolean) => Promise<void | boolean>;
  downloadedEpisodes: Episode[];
  downloadsReady: boolean;
  remoteSession: ResumePoint | null;
}

export function formatTime(time: number) {
  if (!Number.isFinite(time)) return '0:00';
  return `${Math.floor(time / 60)}:${Math.floor(time % 60).toString().padStart(2, '0')}`;
}

interface Selection extends ResumePoint {
  source: string;
  autoplay: boolean;
  ending?: boolean;
  started: boolean;
  positioned: boolean;
}

export function usePodcastPlayer({
  state, ready, skipBackwardSeconds, skipForwardSeconds, updateState, downloadedEpisodes, downloadsReady, remoteSession,
  autoRemoveFinishedDownloads, finishDownload,
}: UsePodcastPlayerProps) {
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const playingPodcast = state.subscriptions.find(s => s.feedUrl === currentEpisode?.podcastId) ?? null;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState(false);
  const [remoteOffer, setRemoteOffer] = useState<ResumePoint | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const selected = useRef<Selection | null>(null);
  const initialized = useRef(false);
  const offer = remoteOffer ?? resumePoint(state);

  useEffect(() => {
    setRemoteOffer(remoteSession);
  }, [remoteSession]);

  const checkpoint = useCallback((urgent: boolean, { started = false, time: seekTime, consume = false }: {
    started?: boolean; time?: number; consume?: boolean;
  } = {}) => {
    const audio = audioRef.current;
    const item = selected.current;
    if (!audio || !item || (seekTime === undefined && (!item.positioned || audio.ended))) return;
    const { episode } = item;
    const episodeUrl = episode.audioUrl;
    const time = seekTime ?? audio.currentTime;
    item.time = time;
    const progress = {
      episodeUrl, currentTime: time, duration: item.positioned && Number.isFinite(audio.duration) ? audio.duration : episode.duration,
      lastUpdated: Date.now(),
    };
    // Save the current episode separately and consume its queue entry when playback is selected.
    void updateState(prev => ({
      ...prev, lastPlayingEpisode: episode,
      playbackProgress: { ...prev.playbackProgress, [episodeUrl]: progress },
      podcastLastPlayed: started ? recordPodcastPlay(prev.podcastLastPlayed, episode.podcastId, progress.lastUpdated)
        : prev.podcastLastPlayed,
      queue: consume ? removeQueuedEpisode(prev.queue, episode.id) : prev.queue,
    }), urgent, !urgent);
  }, [updateState]);

  const requestPlay = useCallback(() => {
    const item = selected.current;
    if (!item || item.ending) return;
    item.autoplay = true;
    if (!item.source) return;
    void audioRef.current?.play().catch(() => {
      if (item === selected.current && item.autoplay) setPlaybackError(true);
    });
  }, []);

  const select = useCallback((episode: Episode, time: number, autoplay: boolean) => {
    const audio = audioRef.current;
    if (!audio) return;
    const old = selected.current;
    if (old?.started && old.episode.audioUrl !== episode.audioUrl) checkpoint(true);
    if (old) old.started = false;
    audio.pause();
    if (old?.source.startsWith('blob:')) URL.revokeObjectURL(old.source);
    const item: Selection = { episode, time, autoplay, started: false, positioned: false, source: '' };
    selected.current = item;
    initialized.current = true;
    setCurrentEpisode(episode);
    setCurrentTime(time);
    setDuration(episode.duration || 0);
    setPlaybackError(false);
    if (autoplay && old?.episode.id !== episode.id) checkpoint(true, { time, consume: true });

    // Preload audio metadata and saved position. A cold offline launch may precede the download list.
    const attach = (blob: Blob | null) => {
      if (selected.current !== item || audioRef.current !== audio) return;
      item.source = blob ? URL.createObjectURL(blob) : episode.audioUrl;
      if (!item.source) { setPlaybackError(true); return; }
      audio.src = item.source;
      audio.load();
      if (item.autoplay) requestPlay();
    };
    if (!downloadsReady || downloadedEpisodes.some(d => d.id === episode.id)) {
      void getAudioBlob(episode.id).then(attach, () => attach(null));
    } else {
      attach(null);
    }
  }, [checkpoint, downloadsReady, downloadedEpisodes, requestPlay]);

  // Initialize from state when it loads
  useEffect(() => {
    const point = resumePoint(state);
    if (ready && point && !initialized.current) select(point.episode, point.time, false);
  }, [ready, state, select]);

  useEffect(() => () => {
    if (selected.current?.source.startsWith('blob:')) URL.revokeObjectURL(selected.current.source);
    selected.current = null;
    initialized.current = false;
  }, []);

  const onMetadata = () => {
    const audio = audioRef.current;
    const item = selected.current;
    if (!audio || !item || audio.currentSrc !== audio.src) return;
    const length = Number.isFinite(audio.duration) ? audio.duration : item.episode.duration;
    setDuration(length);
    audio.currentTime = length > 0 ? Math.min(item.time, length) : item.time;
    item.positioned = true;
    setCurrentTime(audio.currentTime);
  };

  const onPlaying = () => {
    const item = selected.current;
    if (!item || audioRef.current?.paused) return;
    setIsPlaying(true);
    setPlaybackError(false);
    if (!item.started) checkpoint(true, { started: true, consume: true });
    item.started = true;
  };

  const onPause = () => {
    const item = selected.current;
    if (!audioRef.current?.paused) return;
    setIsPlaying(false);
    if (item?.started) {
      checkpoint(true);
      item.started = false;
    }
  };

  const pause = useCallback(() => {
    if (selected.current) selected.current.autoplay = false;
    audioRef.current?.pause();
    // Persist explicit pauses before the browser can suspend the page.
    if (selected.current?.started) {
      setRemoteOffer(null);
      checkpoint(true);
      selected.current.started = false;
    }
  }, [checkpoint]);

  const retry = useCallback(() => {
    const item = selected.current;
    if (item) select(item.episode, item.time, true);
  }, [select]);

  const play = useCallback(() => {
    setRemoteOffer(null);
    if (playbackError) retry();
    else requestPlay();
  }, [playbackError, requestPlay, retry]);

  const togglePlay = useCallback(() => {
    if (audioRef.current?.paused) play();
    else pause();
  }, [play, pause]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    const item = selected.current;
    if (!audio || !item || !Number.isFinite(time)) return;
    const length = item.positioned && Number.isFinite(audio.duration) ? audio.duration : item.episode.duration;
    const target = Math.max(0, length > 0 ? Math.min(time, length) : time);
    setRemoteOffer(null);
    if (item.positioned) audio.currentTime = target;
    // A seek during source loading is applied again when metadata becomes available.
    setCurrentTime(target);
    checkpoint(true, { time: target });
  }, [checkpoint]);
  const skip = useCallback((seconds: number) => {
    const item = selected.current;
    const time = item?.positioned ? audioRef.current?.currentTime : item?.time;
    if (time !== undefined) seek(time + seconds);
  }, [seek]);
  const playEpisode = useCallback((episode: Episode) => {
    setRemoteOffer(null);
    if (selected.current?.episode.id === episode.id) togglePlay();
    else select(episode, state.playbackProgress[episode.audioUrl]?.currentTime ?? 0, true);
  }, [select, state.playbackProgress, togglePlay]);

  const continueListening = () => {
    if (!offer) return;
    setRemoteOffer(null);
    const item = selected.current;
    if (item?.positioned && item.episode.audioUrl === offer.episode.audioUrl && !playbackError) {
      seek(offer.time);
      requestPlay();
    } else {
      select(offer.episode, offer.time, true);
    }
  };

  // Fast UI updates
  const onTimeUpdate = () => {
    const audio = audioRef.current;
    if (audio && selected.current?.positioned && !audio.error) {
      selected.current.time = audio.currentTime;
      setCurrentTime(audio.currentTime);
    }
  };

  // Slow DISK updates
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      if (selected.current?.started) checkpoint(false);
    }, 10000);
    return () => clearInterval(timer);
  }, [isPlaying, checkpoint]);

  // Media Session API: Metadata
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = currentEpisode ? new MediaMetadata({
      title: currentEpisode.title,
      artist: playingPodcast?.title || 'Unknown Podcast',
      album: playingPodcast?.title || 'Unknown Podcast',
      artwork: playingPodcast?.artworkUrl ? [{ src: playingPodcast.artworkUrl }] : [],
    }) : null;
  }, [currentEpisode, playingPodcast]);

  // Media Session API: Action Handlers & Playback State
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const media = navigator.mediaSession;
    media.playbackState = isPlaying ? 'playing' : 'paused';
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', play], ['pause', pause],
      ['seekbackward', details => skip(-(details.seekOffset ?? skipBackwardSeconds))],
      ['seekforward', details => skip(details.seekOffset ?? skipForwardSeconds)],
      ['seekto', details => { if (details.seekTime !== undefined) seek(details.seekTime); }],
    ];
    for (const [action, handler] of actions) {
      try { media.setActionHandler(action, handler); } catch { /* Action unavailable on this platform. */ }
    }
    return () => {
      for (const [action] of actions) {
        try { media.setActionHandler(action, null); } catch { /* Unsupported action. */ }
      }
    };
  }, [isPlaying, play, pause, skip, seek, skipBackwardSeconds, skipForwardSeconds]);

  const handleEpisodeEnded = async () => {
    const audio = audioRef.current;
    const item = selected.current;
    if (!item || item.ending || !audio?.ended) return;
    const { episode } = item;
    item.ending = true;
    item.started = false;
    const finishedAt = Date.now();
    setRemoteOffer(null);
    setIsPlaying(false);
    item.positioned = false;
    audio.removeAttribute('src');
    audio.load();
    if (item.source.startsWith('blob:')) URL.revokeObjectURL(item.source);
    item.source = '';
    if (autoRemoveFinishedDownloads) finishDownload(episode.id);
    // Read the latest queue and persist the handoff and completion together.
    let next: ResumePoint | undefined;
    await updateState(prev => {
      const waiting = removeQueuedEpisode(prev.queue, episode.id);
      const upcoming = nextEpisode(waiting);
      const playbackProgress = { ...prev.playbackProgress };
      delete playbackProgress[episode.audioUrl];
      next = upcoming ? { episode: upcoming, time: playbackProgress[upcoming.audioUrl]?.currentTime ?? 0 } : undefined;
      return {
        ...prev, playbackProgress, lastPlayingEpisode: upcoming,
        podcastLastPlayed: recordPodcastPlay(prev.podcastLastPlayed, episode.podcastId, finishedAt),
        queue: upcoming ? removeQueuedEpisode(waiting, upcoming.id) : waiting,
        playedEpisodes: { ...prev.playedEpisodes, [episode.id]: true },
      };
    }, true);
    if (selected.current !== item) return;
    if (next) {
      select(next.episode, next.time, true);
    } else {
      selected.current = null;
      setCurrentEpisode(null);
      setCurrentTime(0);
      setDuration(0);
      setPlaybackError(false);
    }
  };

  const onError = () => {
    if (selected.current && audioRef.current?.error) {
      selected.current.started = false;
      setIsPlaying(false);
      setPlaybackError(true);
    }
  };

  return {
    currentEpisode, playingPodcast, isPlaying, currentTime, duration, audioRef, offer, hasRemoteOffer: !!remoteOffer, continueListening,
    playbackReady: true,
    playbackError, retry, togglePlay, skip, seek, formatTime, playEpisode,
    audioEvents: { onLoadedMetadata: onMetadata, onPlaying, onPause, onTimeUpdate, onEnded: handleEpisodeEnded,
      onWaiting: () => setIsPlaying(false), onEmptied: () => setIsPlaying(false), onError },
  };
}
