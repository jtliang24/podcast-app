export interface Podcast {
  id: string;
  title: string;
  author: string;
  feedUrl: string;
  artworkUrl: string;
  description: string;
}

export interface Episode {
  id: string;
  podcastId: string;
  title: string;
  pubDate: string;
  audioUrl: string;
  duration: number;
  description: string;
  keywords?: string[];
}

export interface PlaybackProgress {
  episodeUrl: string;
  currentTime: number;
  duration: number;
  lastUpdated: number;
}

export type SortOrder = 'newest' | 'oldest' | 'a-z' | 'z-a' | 'longest' | 'shortest';

export type CellularDownload = 'yes' | 'no' | 'ask';
export const SKIP_INTERVALS = [10, 15, 30, 60] as const;
export type SkipInterval = typeof SKIP_INTERVALS[number];

export interface AppState {
  subscriptions: Podcast[];
  playbackProgress: Record<string, PlaybackProgress>;
  queue: Episode[];
  newReleases: Episode[];
  lastRefresh?: number;
  podcastSortOrders: Record<string, SortOrder>;
  playedEpisodes: Record<string, boolean>;
  hidePlayedEpisodes: Record<string, boolean>;
  lastPlayingEpisode?: Episode | null;
  cellularDownload?: CellularDownload;
  autoDownloadQueued?: boolean;
  skipBackwardSeconds?: SkipInterval;
  skipForwardSeconds?: SkipInterval;
}

export const INITIAL_STATE: AppState = {
  subscriptions: [],
  playbackProgress: {},
  queue: [],
  newReleases: [],
  podcastSortOrders: {},
  playedEpisodes: {},
  hidePlayedEpisodes: {},
  lastPlayingEpisode: null,
};
