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
}

export interface PlaybackProgress {
  episodeUrl: string;
  currentTime: number;
  duration: number;
  lastUpdated: number;
}

export interface AppState {
  subscriptions: Podcast[];
  playbackProgress: Record<string, PlaybackProgress>;
  queue: Episode[];
  newReleases: Episode[];
  lastRefresh?: number;
}

export const INITIAL_STATE: AppState = {
  subscriptions: [],
  playbackProgress: {},
  queue: [],
  newReleases: [],
};
