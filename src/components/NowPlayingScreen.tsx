import { useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import { ChevronDown, Pause, Play, Podcast as PodcastIcon, RotateCcw, RotateCw } from 'lucide-react';
import type { Episode, Podcast, SkipInterval } from '../types';
import SpeedControl from './SpeedControl';
import SleepTimerControl from './SleepTimerControl';
import { formatSpeed } from '../services/preferences';
import type { SleepTimerControls } from '../services/sleepTimer';

interface PlaybackTimelineProps {
  currentTime: number;
  duration: number;
  seek: (time: number) => void;
  formatTime: (time: number) => string;
}

interface NowPlayingScreenProps extends PlaybackTimelineProps {
  ref: Ref<HTMLDialogElement>;
  episode: Episode | null;
  podcast: Podcast | null;
  isPlaying: boolean;
  togglePlay: () => void;
  skip: (seconds: number) => void;
  skipBackwardSeconds: SkipInterval;
  skipForwardSeconds: SkipInterval;
  playbackError: boolean;
  retry: () => void;
  speed: number;
  hasSpeedOverride: boolean;
  onSpeed: (speed: number) => void;
  onSpeedOverride: (enabled: boolean) => void;
  sleep: SleepTimerControls;
}

function PlaybackTimeline({ currentTime, duration, seek, formatTime }: PlaybackTimelineProps) {
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const activePointer = useRef<number | null>(null);
  const length = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const position = Math.max(0, Math.min(previewTime ?? currentTime, length));
  const progress = length > 0 ? 100 * position / length : 0;
  const elapsed = formatTime(length > 0 ? position : currentTime);
  const total = formatTime(length);

  const clearPreview = () => {
    activePointer.current = null;
    setPreviewTime(null);
  };

  return (
    <div className="w-full">
      <input
        aria-label="Playback position"
        aria-valuetext={`${elapsed} of ${total}`}
        type="range"
        min={0}
        max={length}
        step={0.1}
        value={position}
        disabled={length === 0}
        className="now-playing-timeline block h-12 w-full cursor-pointer touch-none appearance-none rounded-lg bg-transparent disabled:cursor-default disabled:opacity-50"
        style={{ '--playback-progress': `${progress}%` } as CSSProperties}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return;
          activePointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onChange={event => {
          const time = event.currentTarget.valueAsNumber;
          if (activePointer.current === null) seek(time);
          else setPreviewTime(time);
        }}
        onPointerUp={event => {
          if (activePointer.current !== event.pointerId) return;
          if (previewTime !== null) seek(event.currentTarget.valueAsNumber);
          clearPreview();
        }}
        onLostPointerCapture={event => {
          if (activePointer.current === event.pointerId) clearPreview();
        }}
        onBlur={clearPreview}
      />
      <div className="flex justify-between text-sm tabular-nums text-slate-300">
        <span><span className="sr-only">Elapsed </span>{elapsed}</span>
        <span><span className="sr-only">Duration </span>{total}</span>
      </div>
    </div>
  );
}

export default function NowPlayingScreen({
  ref, episode, podcast, isPlaying, togglePlay, skip, skipBackwardSeconds, skipForwardSeconds, playbackError, retry, speed, hasSpeedOverride, onSpeed, onSpeedOverride, sleep, ...timeline
}: NowPlayingScreenProps) {
  const remaining = timeline.formatTime((timeline.duration - timeline.currentTime) / speed);
  return (
    <dialog
      ref={ref}
      id="now-playing"
      aria-labelledby="now-playing-heading"
      className="now-playing-dialog m-0 h-full max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-slate-950 p-0 text-white"
    >
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-3 md:px-8">
          <form method="dialog">
            <button type="submit" aria-label="Close Now Playing" className="grid h-11 w-11 place-items-center rounded-full bg-slate-800 hover:bg-slate-700">
              <ChevronDown size={24} aria-hidden="true" />
            </button>
          </form>
          <h1 id="now-playing-heading" className="text-lg font-semibold">Now Playing</h1>
        </div>
      </header>

      {episode ? (
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-5 py-6 md:gap-7 md:px-8 md:py-8">
          <div className="grid aspect-square w-[clamp(6rem,34dvh,20rem)] max-w-full place-items-center overflow-hidden rounded-2xl bg-slate-900 text-slate-600 shadow-xl">
            {podcast?.artworkUrl ? (
              <img src={podcast.artworkUrl} className="h-full w-full object-cover" alt="" />
            ) : (
              <PodcastIcon className="h-1/3 w-1/3" aria-hidden="true" />
            )}
          </div>

          <div className="w-full break-words text-center">
            <h2 className="text-xl font-bold md:text-3xl">{episode.title}</h2>
            {podcast?.title && <p className="mt-1 text-sm font-medium text-blue-400 md:text-base">{podcast.title}</p>}
          </div>

          {playbackError && (
            <div role="alert" className="text-center text-sm text-red-300">
              Couldn’t play this episode. <button type="button" className="ml-2 font-bold underline" onClick={retry}>Retry playback</button>
            </div>
          )}

          <PlaybackTimeline key={episode.audioUrl} {...timeline} />
          {speed !== 1 && Number.isFinite(timeline.duration) && timeline.duration > timeline.currentTime && (
            <p className="-mt-3 text-sm tabular-nums text-slate-400">
              <span className="sr-only">{remaining} remaining at {formatSpeed(speed)}</span>
              <span aria-hidden="true">-{remaining} at {formatSpeed(speed)}</span>
            </p>
          )}

          <div className="flex items-center gap-7 md:gap-10">
            <button type="button" aria-label={`Back ${skipBackwardSeconds} seconds`} onClick={() => skip(-skipBackwardSeconds)} className="flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-full text-slate-300 hover:bg-slate-800 hover:text-white">
              <RotateCcw size={24} aria-hidden="true" />
              <span className="text-xs font-semibold">{skipBackwardSeconds}s</span>
            </button>
            <button type="button" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlay} className="grid h-16 w-16 place-items-center rounded-full bg-white text-slate-900 shadow-lg hover:bg-slate-200">
              {isPlaying ? <Pause fill="currentColor" size={30} /> : <Play fill="currentColor" size={30} className="ml-1" />}
            </button>
            <button type="button" aria-label={`Forward ${skipForwardSeconds} seconds`} onClick={() => skip(skipForwardSeconds)} className="flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-full text-slate-300 hover:bg-slate-800 hover:text-white">
              <RotateCw size={24} aria-hidden="true" />
              <span className="text-xs font-semibold">{skipForwardSeconds}s</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <SpeedControl
              speed={speed}
              hasOverride={hasSpeedOverride}
              canOverride={!!episode.podcastId}
              onSpeed={onSpeed}
              onOverride={onSpeedOverride}
              className="px-4 py-2 text-sm"
            />
            <SleepTimerControl {...sleep} className="px-4 py-2 text-sm" />
          </div>
        </div>
      ) : (
        <p className="px-5 py-12 text-center text-slate-400">No episode selected</p>
      )}
    </dialog>
  );
}
