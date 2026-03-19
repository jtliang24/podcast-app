import { useState, useRef, useEffect, useCallback } from 'react';
import type { Episode, Podcast, AppState, PlaybackProgress } from '../types';
import { getAudioBlob } from '../services/storageService';

interface UsePodcastPlayerProps {
  state: AppState;
  storageMode: string | null;
  updateState: (update: AppState | ((prev: AppState) => AppState)) => Promise<void>;
  downloadedEpisodes: Episode[];
  handleDownload: (episode: Episode) => Promise<void>;
  toggleEpisodePlayed: (episodeId: string, played: boolean) => void;
}

export function usePodcastPlayer({
  state,
  storageMode,
  updateState,
  downloadedEpisodes,
  handleDownload,
  toggleEpisodePlayed
}: UsePodcastPlayerProps) {
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const [playingPodcast, setPlayingPodcast] = useState<Podcast | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const saveProgress = useCallback((episodeUrl: string, currentTime: number, duration: number) => {
    if (!storageMode) return;
    const progress: PlaybackProgress = { episodeUrl, currentTime, duration, lastUpdated: Date.now() };
    updateState(prev => ({ ...prev, playbackProgress: { ...prev.playbackProgress, [episodeUrl]: progress } }));
  }, [storageMode, updateState]);

  const togglePlay = useCallback(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        if (currentEpisode) {
          saveProgress(currentEpisode.audioUrl, audioRef.current.currentTime, audioRef.current.duration);
        }
      } else {
        audioRef.current.play().catch(console.error);
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying, currentEpisode, saveProgress]);

  const skip = useCallback((seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime += seconds;
      setCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Fast UI updates
  useEffect(() => {
    const interval = setInterval(() => {
      if (audioRef.current && isPlaying) {
        setCurrentTime(audioRef.current.currentTime);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Slow DISK updates
  useEffect(() => {
    const interval = setInterval(() => {
      if (audioRef.current && currentEpisode && isPlaying) {
        saveProgress(currentEpisode.audioUrl, audioRef.current.currentTime, audioRef.current.duration);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [currentEpisode, isPlaying, saveProgress]);

  // Media Session API: Metadata
  useEffect(() => {
    if ('mediaSession' in navigator && currentEpisode) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentEpisode.title,
        artist: playingPodcast?.title || 'Unknown Podcast',
        album: playingPodcast?.title || 'Unknown Podcast',
        artwork: playingPodcast?.artworkUrl ? [
          { src: playingPodcast.artworkUrl, sizes: '512x512', type: 'image/jpeg' },
          { src: playingPodcast.artworkUrl, sizes: '256x256', type: 'image/jpeg' },
          { src: playingPodcast.artworkUrl, sizes: '128x128', type: 'image/jpeg' }
        ] : []
      });
    }
  }, [currentEpisode, playingPodcast]);

  // Media Session API: Action Handlers & Playback State
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

      navigator.mediaSession.setActionHandler('play', () => {
        togglePlay();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        togglePlay();
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        skip(-(details.seekOffset || 15));
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        skip(details.seekOffset || 30);
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (audioRef.current && details.seekTime !== undefined && details.seekTime !== null) {
          audioRef.current.currentTime = details.seekTime;
          setCurrentTime(details.seekTime);
        }
      });
    }

    return () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
        navigator.mediaSession.setActionHandler('seekto', null);
      }
    };
  }, [isPlaying, togglePlay, skip]);

  const playEpisode = useCallback(async (episode: Episode) => {
    if (currentEpisode?.id === episode.id) {
      togglePlay();
      return;
    }

    if (audioRef.current && currentEpisode) {
      saveProgress(currentEpisode.audioUrl, audioRef.current.currentTime, audioRef.current.duration);
    }

    const podcast = state.subscriptions.find(s => s.feedUrl === episode.podcastId);
    setPlayingPodcast(podcast || null);
    setCurrentEpisode(episode);
    setIsPlaying(true);
    
    if (audioRef.current) {
      const savedProgress = state.playbackProgress[episode.audioUrl];
      
      if (audioRef.current.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioRef.current.src);
      }

      const isDownloaded = downloadedEpisodes.some(d => d.id === episode.id);
      
      if (isDownloaded) {
        const blob = await getAudioBlob(episode.id);
        if (blob) {
          audioRef.current.src = URL.createObjectURL(blob);
        } else {
          audioRef.current.src = episode.audioUrl;
        }
      } else {
        audioRef.current.src = episode.audioUrl;
        handleDownload(episode);
      }
      
      if (savedProgress) {
        audioRef.current.currentTime = savedProgress.currentTime;
        setCurrentTime(savedProgress.currentTime);
      } else {
        setCurrentTime(0);
      }
      audioRef.current.play().catch(console.error);
    }
  }, [currentEpisode, state.playbackProgress, state.subscriptions, downloadedEpisodes, togglePlay, saveProgress, handleDownload]);

  const handleEpisodeEnded = useCallback(() => {
    if (currentEpisode) {
      toggleEpisodePlayed(currentEpisode.id, true);
    }
    
    if (state.queue.length > 0) {
      const nextEpisode = state.queue[0];
      updateState(prev => ({ ...prev, queue: prev.queue.slice(1) }));
      playEpisode(nextEpisode);
    } else {
      setIsPlaying(false);
    }
  }, [state.queue, updateState, playEpisode, currentEpisode, toggleEpisodePlayed]);

  return {
    currentEpisode,
    playingPodcast,
    isPlaying,
    currentTime,
    duration,
    audioRef,
    setDuration,
    setIsPlaying,
    togglePlay,
    skip,
    handleSeek,
    formatTime,
    playEpisode,
    handleEpisodeEnded
  };
}
