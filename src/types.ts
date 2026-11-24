export interface Podcast {
  id: string;
  title: string;
  author: string;
  feedUrl: string;
  artworkUrl: string;
  description: string;
  addedAt?: number;
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

export interface EpisodeQueue {
  primary: Episode[];
  secondary: Episode[];
}

export type QueueTier = keyof EpisodeQueue;
export type QueueAction = 'play-next' | 'play-up-next' | 'add-to-queue';
export type QueueEpisode = (episode: Episode, action: QueueAction) => void;

export interface PlaybackProgress {
  episodeUrl: string;
  currentTime: number;
  duration: number;
  lastUpdated: number;
}

export type SortOrder = 'newest' | 'oldest' | 'a-z' | 'z-a' | 'longest' | 'shortest';
export type SubscriptionSortField = 'release-date' | 'title' | 'date-added' | 'recently-played';
export type SubscriptionSortDirection = 'ascending' | 'descending';

export type CellularDownload = 'yes' | 'no' | 'ask';
export const SKIP_INTERVALS = [10, 15, 30, 60] as const;
export type SkipInterval = typeof SKIP_INTERVALS[number];

export interface AppState {
  subscriptions: Podcast[];
  playbackProgress: Record<string, PlaybackProgress>;
  queue: EpisodeQueue;
  newReleases: Episode[];
  lastRefresh?: number;
  podcastSortOrders: Record<string, SortOrder>;
  subscriptionSortField?: SubscriptionSortField;
  subscriptionSortDirection?: SubscriptionSortDirection;
  podcastReleaseDates?: Record<string, number | null>;
  podcastLastPlayed?: Record<string, number>;
  playedEpisodes: Record<string, boolean>;
  hidePlayedEpisodes: Record<string, boolean>;
  lastPlayingEpisode?: Episode | null;
  cellularDownload?: CellularDownload;
  autoDownloadQueued?: boolean;
  autoRemoveFinishedDownloads?: boolean;
  skipBackwardSeconds?: SkipInterval;
  skipForwardSeconds?: SkipInterval;
}

export const INITIAL_STATE: AppState = {
  subscriptions: [],
  playbackProgress: {},
  queue: { primary: [], secondary: [] },
  newReleases: [],
  podcastSortOrders: {},
  playedEpisodes: {},
  hidePlayedEpisodes: {},
  lastPlayingEpisode: null,
};
