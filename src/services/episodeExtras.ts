import type { Episode } from '../types.ts';
import { fetchPodcastFeed } from './podcastService.ts';

type FeedFetcher = typeof fetchPodcastFeed;
type FeedResult = Awaited<ReturnType<FeedFetcher>>;

const feeds = new Map<string, Promise<FeedResult>>();

/** Forgets the memoized feeds (for tests). */
export function clearExtrasCache(): void {
  feeds.clear();
}

function loadFeed(feedUrl: string, fetcher: FeedFetcher): Promise<FeedResult> {
  let pending = feeds.get(feedUrl);
  if (!pending) {
    pending = fetcher(feedUrl);
    feeds.set(feedUrl, pending);
    // A failed fetch is dropped so a later call can retry.
    pending.catch(() => {
      if (feeds.get(feedUrl) === pending) feeds.delete(feedUrl);
    });
  }
  return pending;
}

/**
 * Returns the episode with its chapter and transcript info. Episodes saved by an older version have
 * `transcripts === undefined`; for those the podcast feed is fetched once per session (memoized per feed
 * URL, `episode.podcastId`) and the episode is matched by `id`. `fetchPodcastFeed` applies the private
 * Substack rule. Nothing is written back to stored state, which avoids sync churn.
 *
 * If the feed can't be fetched or no longer lists the episode, the result has `transcripts: []`, so
 * callers see "no extras" instead of retrying in a loop; the failed fetch itself is not memoized.
 */
export async function resolveExtras(episode: Episode, fetcher: FeedFetcher = fetchPodcastFeed): Promise<Episode> {
  if (episode.transcripts !== undefined) return episode;
  try {
    const { episodes } = await loadFeed(episode.podcastId, fetcher);
    const fresh = episodes.find(item => item.id === episode.id);
    if (!fresh) return { ...episode, transcripts: [] };
    return {
      ...episode,
      chaptersUrl: fresh.chaptersUrl,
      inlineChapters: fresh.inlineChapters,
      transcripts: fresh.transcripts ?? [],
    };
  } catch {
    return { ...episode, transcripts: [] };
  }
}
