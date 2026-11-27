import { MAX_SPEED, MIN_SPEED, SKIP_INTERVALS } from '../types.ts';
import type { AppState, SkipInterval } from '../types.ts';

export type Preferences = Required<Pick<AppState,
  'cellularDownload' | 'autoDownloadQueued' | 'autoRemoveFinishedDownloads' | 'skipBackwardSeconds' | 'skipForwardSeconds' | 'playbackSpeed'
>>;

function skipInterval(value: SkipInterval | undefined, fallback: SkipInterval) {
  return value !== undefined && SKIP_INTERVALS.includes(value) ? value : fallback;
}

function speed(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(value * 20) / 20));
}

/** Playback speed for a podcast (its feedUrl): the override if one exists, else the global speed. */
export function speedFor(state: AppState, podcastId?: string) {
  const global = speed(state.playbackSpeed, 1);
  const override = podcastId !== undefined && Object.hasOwn(state.podcastPlaybackSpeeds ?? {}, podcastId)
    ? state.podcastPlaybackSpeeds?.[podcastId] : undefined;
  return speed(override, global);
}

export function getPreferences(state: AppState): Preferences {
  const { cellularDownload, autoDownloadQueued, skipBackwardSeconds, skipForwardSeconds } = state;
  return {
    cellularDownload: cellularDownload === 'yes' || cellularDownload === 'no' ? cellularDownload : 'ask',
    autoDownloadQueued: typeof autoDownloadQueued === 'boolean' ? autoDownloadQueued : true,
    autoRemoveFinishedDownloads: state.autoRemoveFinishedDownloads === true,
    skipBackwardSeconds: skipInterval(skipBackwardSeconds, 15),
    skipForwardSeconds: skipInterval(skipForwardSeconds, 30),
    playbackSpeed: speed(state.playbackSpeed, 1),
  };
}
