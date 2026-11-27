import type { Episode, InlineChapter, TranscriptRef } from '../types.ts';
import { fetchPodcastFeed } from './podcastService.ts';
// The two modules import each other, but only call each other's functions, never at module load.
import { storedExtras } from './extrasCache.ts';

type FeedFetcher = typeof fetchPodcastFeed;
type FeedResult = Awaited<ReturnType<FeedFetcher>>;

/** The chapter and transcript info an episode copy saved by an older version lacks. */
export interface EpisodeExtras {
  chaptersUrl?: string;
  inlineChapters?: InlineChapter[];
  transcripts: TranscriptRef[];
}

/** Reads the extras this device kept for a downloaded episode (see `pinExtras`); `undefined` if none. */
export type StoredExtrasLookup = (episodeId: string) => Promise<EpisodeExtras | undefined>;

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
 * Finds the extras of an episode copy saved by an older version: those this device kept when it downloaded
 * the episode, otherwise the podcast feed's (fetched once per session, memoized per feed URL). Resolves to
 * `undefined` when neither is available: the feed can't be fetched or no longer lists the episode.
 */
export async function lookupExtras(
  episode: Episode,
  fetcher: FeedFetcher = fetchPodcastFeed,
  stored: StoredExtrasLookup = storedExtras,
): Promise<EpisodeExtras | undefined> {
  try {
    const kept = await stored(episode.id);
    if (kept) return kept;
  } catch {
    // Best effort: fall back to the feed.
  }
  try {
    const { episodes } = await loadFeed(episode.podcastId, fetcher);
    const fresh = episodes.find(item => item.id === episode.id);
    if (!fresh) return undefined;
    return { chaptersUrl: fresh.chaptersUrl, inlineChapters: fresh.inlineChapters, transcripts: fresh.transcripts ?? [] };
  } catch {
    return undefined;
  }
}

/**
 * Returns the episode with its chapter and transcript info. Episodes saved by an older version have
 * `transcripts === undefined`; for those the extras this device kept for a download are used, otherwise the
 * podcast feed is fetched once per session (memoized per feed URL, `episode.podcastId`) and the episode is
 * matched by `id`. `fetchPodcastFeed` applies the private Substack rule. Nothing is written back to stored
 * state, which avoids sync churn.
 *
 * If the feed can't be fetched or no longer lists the episode, the result has `transcripts: []`, so
 * callers see "no extras" instead of retrying in a loop; the failed fetch itself is not memoized.
 */
export async function resolveExtras(
  episode: Episode,
  fetcher: FeedFetcher = fetchPodcastFeed,
  stored: StoredExtrasLookup = storedExtras,
): Promise<Episode> {
  if (episode.transcripts !== undefined) return episode;
  const extras = await lookupExtras(episode, fetcher, stored);
  if (!extras) return { ...episode, transcripts: [] };
  return {
    ...episode,
    chaptersUrl: extras.chaptersUrl,
    inlineChapters: extras.inlineChapters,
    transcripts: extras.transcripts,
  };
}
