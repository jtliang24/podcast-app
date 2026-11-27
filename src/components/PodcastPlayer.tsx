import React, { useRef, useState } from 'react';
import { 
  RotateCcw, RotateCw, Pause, Play, List, Maximize2, Moon, Podcast as PodcastIcon
} from 'lucide-react';
import type { Episode, Podcast, SkipInterval } from '../types';
import type { SleepTimer, SleepTimerControls } from '../services/sleepTimer';
import { useSleepTimerLabel } from '../hooks/useSleepTimer';
import NowPlayingScreen from './NowPlayingScreen';
import SpeedControl from './SpeedControl';

interface PodcastPlayerProps {
  queueButton: React.Ref<HTMLButtonElement>;
  queueOpen: boolean;
  queueCount: number;
  onQueue: () => void;
  currentEpisode: Episode | null;
  playingPodcast: Podcast | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  togglePlay: () => void;
  skip: (seconds: number) => void;
  skipBackwardSeconds: SkipInterval;
  skipForwardSeconds: SkipInterval;
  seek: (time: number) => void;
  speed: number;
  hasSpeedOverride: boolean;
  onSpeed: (speed: number) => void;
  onSpeedOverride: (enabled: boolean) => void;
  sleep: SleepTimerControls;
  formatTime: (time: number) => string;
  playbackError: boolean;
  retry: () => void;
}

/** Shows the sleep timer's time left in the player bar. Now Playing has the controls. */
function SleepIndicator({ timer }: { timer: SleepTimer | null }) {
  const label = useSleepTimerLabel(timer);
  if (!label) return null;
  return (
    <span className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 tabular-nums text-blue-300">
      <Moon size={12} aria-hidden="true" />
      <span className="sr-only">Sleep timer: </span>{label}
    </span>
  );
}

const PodcastPlayer: React.FC<PodcastPlayerProps> = ({
  queueButton,
  queueOpen,
  queueCount,
  onQueue,
  currentEpisode,
  playingPodcast,
  isPlaying,
  currentTime,
  duration,
  togglePlay,
  skip,
  skipBackwardSeconds,
  skipForwardSeconds,
  seek,
  speed,
  hasSpeedOverride,
  onSpeed,
  onSpeedOverride,
  sleep,
  formatTime,
  playbackError,
  retry,
}) => {
  const nowPlayingRef = useRef<HTMLDialogElement>(null);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const hasDuration = Number.isFinite(duration) && duration > 0;
  const progress = hasDuration && Number.isFinite(currentTime) ? currentTime / duration : 0;

  return (
    <footer id="player-bar" className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 p-3 md:p-6 z-50">
      {playbackError && (
        <div role="alert" className="mb-2 text-center text-sm text-red-300">
          Couldn’t play this episode. <button className="ml-2 font-bold underline" onClick={retry}>Retry playback</button>
        </div>
      )}
      <div className="max-w-screen-2xl mx-auto flex flex-col items-center">
        <div className="w-full flex flex-wrap items-center justify-between gap-y-2 mb-2">
          <button
            type="button"
            aria-label={currentEpisode ? `Open Now Playing: ${currentEpisode.title}` : undefined}
            aria-haspopup="dialog"
            aria-controls="now-playing"
            onClick={event => {
              event.currentTarget.focus();
              const dialog = nowPlayingRef.current;
              if (!dialog || dialog.open) return;
              dialog.showModal();
              setNowPlayingOpen(true);
            }}
            disabled={!currentEpisode}
            className="flex w-full min-w-0 items-center gap-3 rounded-lg text-left enabled:hover:bg-slate-800 md:w-1/3"
          >
            {playingPodcast?.artworkUrl ? (
              <img src={playingPodcast.artworkUrl} className="h-12 w-12 shrink-0 rounded bg-slate-800 shadow-lg" alt="" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-slate-800 text-slate-600 shadow-lg">
                <PodcastIcon size={24} />
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{currentEpisode?.title || 'No episode selected'}</span>
              <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-blue-400">{playingPodcast?.title || (currentEpisode ? 'Unknown Podcast' : 'Ready to listen')}</span>
            </span>
            {currentEpisode && <Maximize2 size={18} className="ml-auto mr-3 shrink-0 text-blue-400" aria-hidden="true" />}
          </button>

          <div className="flex items-center justify-center space-x-4 md:space-x-10 md:w-1/3">
            <button 
              aria-label={`Back ${skipBackwardSeconds} seconds`}
              onClick={() => skip(-skipBackwardSeconds)}
              disabled={!currentEpisode}
              className="text-slate-500 hover:text-white disabled:opacity-30 disabled:hover:text-slate-500 transition-colors flex flex-col items-center"
            >
              <RotateCcw size={22} />
              <span className="text-[8px] font-black mt-1">{skipBackwardSeconds}s</span>
            </button>
            <button 
              aria-label={isPlaying ? 'Pause' : 'Play'}
              onClick={togglePlay} 
              disabled={!currentEpisode}
              className="bg-white text-slate-900 w-14 h-14 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100 transition-all shadow-xl"
            >
              {isPlaying ? <Pause fill="currentColor" size={28} /> : <Play fill="currentColor" size={28} className="ml-1" />}
            </button>
            <button 
              aria-label={`Forward ${skipForwardSeconds} seconds`}
              onClick={() => skip(skipForwardSeconds)}
              disabled={!currentEpisode}
              className="text-slate-500 hover:text-white disabled:opacity-30 disabled:hover:text-slate-500 transition-colors flex flex-col items-center"
            >
              <RotateCw size={22} />
              <span className="text-[8px] font-black mt-1">{skipForwardSeconds}s</span>
            </button>
          </div>

          <div className="md:w-1/3 flex justify-end items-center space-x-2 md:space-x-6 text-[10px] font-mono font-bold text-slate-500">
            <button 
              ref={queueButton}
              onClick={onQueue}
              aria-current={queueOpen ? 'page' : undefined}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg transition-colors ${queueOpen ? 'bg-blue-600 text-white' : 'bg-slate-800 hover:bg-slate-700'}`}
            >
              <List size={14} />
              <span>Queue ({queueCount})</span>
            </button>
            <SpeedControl
              speed={speed}
              hasOverride={hasSpeedOverride}
              canOverride={!!currentEpisode}
              disabled={!currentEpisode}
              onSpeed={onSpeed}
              onOverride={onSpeedOverride}
            />
            <SleepIndicator timer={sleep.sleepTimer} />
            <span className="bg-slate-800 px-2 py-1 rounded">{formatTime(currentTime)} / {formatTime(duration)}</span>
          </div>
        </div>

        <div className="w-full max-w-2xl px-4 flex items-center">
          <progress
            aria-label="Playback progress"
            value={currentEpisode ? progress : 0}
            className="h-1 w-full appearance-none overflow-hidden rounded-lg bg-slate-800 [&::-webkit-progress-bar]:bg-slate-800 [&::-webkit-progress-value]:bg-blue-500 [&::-moz-progress-bar]:bg-blue-500"
          />
        </div>
      </div>
      <NowPlayingScreen
        ref={nowPlayingRef}
        open={nowPlayingOpen}
        onClose={() => setNowPlayingOpen(false)}
        episode={currentEpisode}
        podcast={playingPodcast}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        togglePlay={togglePlay}
        skip={skip}
        skipBackwardSeconds={skipBackwardSeconds}
        skipForwardSeconds={skipForwardSeconds}
        seek={seek}
        speed={speed}
        hasSpeedOverride={hasSpeedOverride}
        onSpeed={onSpeed}
        onSpeedOverride={onSpeedOverride}
        sleep={sleep}
        formatTime={formatTime}
        playbackError={playbackError}
        retry={retry}
      />
    </footer>
  );
};

export default PodcastPlayer;
