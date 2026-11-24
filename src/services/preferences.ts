import { SKIP_INTERVALS } from '../types.ts';
import type { AppState, SkipInterval } from '../types.ts';

export type Preferences = Required<Pick<AppState,
  'cellularDownload' | 'autoDownloadQueued' | 'autoRemoveFinishedDownloads' | 'skipBackwardSeconds' | 'skipForwardSeconds'
>>;

function skipInterval(value: SkipInterval | undefined, fallback: SkipInterval) {
  return value !== undefined && SKIP_INTERVALS.includes(value) ? value : fallback;
}

export function getPreferences(state: AppState): Preferences {
  const { cellularDownload, autoDownloadQueued, skipBackwardSeconds, skipForwardSeconds } = state;
  return {
    cellularDownload: cellularDownload === 'yes' || cellularDownload === 'no' ? cellularDownload : 'ask',
    autoDownloadQueued: typeof autoDownloadQueued === 'boolean' ? autoDownloadQueued : true,
    autoRemoveFinishedDownloads: state.autoRemoveFinishedDownloads === true,
    skipBackwardSeconds: skipInterval(skipBackwardSeconds, 15),
    skipForwardSeconds: skipInterval(skipForwardSeconds, 30),
  };
}
