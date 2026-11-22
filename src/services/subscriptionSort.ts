import type { AppState, Episode, Podcast, SubscriptionSortDirection, SubscriptionSortField } from '../types';

export function latestEpisodeRelease(episodes: Episode[]): number | null {
  let latest: number | null = null;
  for (const episode of episodes) {
    const date = Date.parse(episode.pubDate);
    if (Number.isFinite(date) && (latest === null || date > latest)) latest = date;
  }
  return latest;
}

export function releaseDatesByPodcast(episodes: Episode[]) {
  const cachedDates = new Map<string, number>();
  for (const episode of episodes) {
    const date = Date.parse(episode.pubDate);
    if (Number.isFinite(date) && date > (cachedDates.get(episode.podcastId) ?? -Infinity)) {
      cachedDates.set(episode.podcastId, date);
    }
  }
  return cachedDates;
}

export function sortSubscriptions(
  subscriptions: Podcast[],
  field: SubscriptionSortField,
  direction: SubscriptionSortDirection,
  releaseDates: AppState['podcastReleaseDates'],
  lastPlayed: AppState['podcastLastPlayed'],
  newReleases: Episode[],
) {
  const cachedDates = field === 'release-date' ? releaseDatesByPodcast(newReleases) : undefined;
  const dateFor = (podcast: Podcast) => {
    switch (field) {
      case 'release-date': {
        const date = releaseDates?.[podcast.feedUrl];
        return date === undefined ? cachedDates?.get(podcast.feedUrl) : date;
      }
      case 'date-added':
        return podcast.addedAt;
      case 'recently-played':
        return lastPlayed?.[podcast.feedUrl];
    }
  };
  const multiplier = direction === 'ascending' ? 1 : -1;
  const compareTitles = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  const sortable = subscriptions.map(podcast => ({ podcast, date: dateFor(podcast) }));
  sortable.sort((a, b) => {
    if (field === 'title') return multiplier * compareTitles(a.podcast.title, b.podcast.title);
    const { date: aDate } = a;
    const { date: bDate } = b;
    const aKnown = typeof aDate === 'number' && Number.isFinite(aDate);
    const bKnown = typeof bDate === 'number' && Number.isFinite(bDate);
    if (aKnown && bKnown && aDate !== bDate) return multiplier * (aDate - bDate);
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    return compareTitles(a.podcast.title, b.podcast.title);
  });
  return sortable.map(({ podcast }) => podcast);
}

export function recordPodcastPlay(
  lastPlayed: AppState['podcastLastPlayed'], podcastId: string, time: number,
) {
  return Number.isFinite(time) && time > (lastPlayed?.[podcastId] ?? 0)
    ? { ...lastPlayed, [podcastId]: time } : lastPlayed;
}
