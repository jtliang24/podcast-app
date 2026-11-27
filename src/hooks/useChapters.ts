import { useEffect, useMemo, useRef, useState } from 'react';
import type { Episode } from '../types';
import { artworkAt, chapterPosition, fromInlineChapters, lastStartedIndex, parseJsonChapters, tocChapters } from '../services/chapters';
import type { Chapter } from '../services/chapters';
import { resolveExtras } from '../services/episodeExtras';
import { CHAPTERS_TYPE, loadEpisodeExtra } from '../services/extrasCache';

export interface EpisodeChapters {
  /** The chapters to list and navigate (`toc` ones), sorted. Empty when the episode has none. */
  chapters: Chapter[];
  /** The chapter playing now. Its `end` is when it stops (`Infinity` if unknown). */
  current?: Chapter;
  next?: Chapter;
  /** Where **Previous chapter** goes: the current chapter when more than 3 s into it, otherwise the one before. */
  previous?: Chapter;
  /** The HTTPS chapter image for the current time, from any chapter including `toc: false` ones. */
  artwork?: string;
}

/** Fetched chapter text, tagged with the episode and URL it belongs to so a stale result is never shown. */
interface Loaded {
  key: string;
  /** A JSON chapters file, or the inline chapters of an older stored episode resolved from its feed. */
  source: { json: string } | { inline: Episode['inlineChapters'] };
}

const episodeKey = (episode: Episode) => `${episode.podcastId}\n${episode.id}\n${episode.chaptersUrl ?? ''}`;

/**
 * The episode's chapters, and where `currentTime` is among them. Inline (Podlove) chapters are used right away.
 * Otherwise the episode's extras are resolved (older stored copies lack them) and the `chaptersUrl` file is
 * loaded through the per-device cache; a load for an episode that is no longer current is dropped. End times
 * are recomputed when `duration` becomes known.
 *
 * The chapter lists only change with the episode or duration, and the returned object only changes when the
 * current chapter, the **Previous** target or the artwork does, so the ~4 Hz `currentTime` updates are cheap.
 */
export function useChapters(episode: Episode | null, duration: number, currentTime: number): EpisodeChapters {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const episodeRef = useRef(episode);
  episodeRef.current = episode;

  const key = episode ? episodeKey(episode) : null;
  const inline = episode?.inlineChapters?.length ? episode.inlineChapters : undefined;
  const needsLoad = key !== null && !inline && (!!episode?.chaptersUrl || episode?.transcripts === undefined);

  useEffect(() => {
    const target = episodeRef.current;
    if (!needsLoad || !target || key === null) return;
    let cancelled = false;
    (async () => {
      const resolved = await resolveExtras(target);
      if (cancelled) return;
      if (resolved.inlineChapters?.length) {
        setLoaded({ key, source: { inline: resolved.inlineChapters } });
        return;
      }
      if (!resolved.chaptersUrl) return;
      const json = await loadEpisodeExtra(resolved, { url: resolved.chaptersUrl, type: CHAPTERS_TYPE });
      if (!cancelled && json !== null) setLoaded({ key, source: { json } });
    })();
    return () => { cancelled = true; };
  }, [key, needsLoad]);

  const length = Number.isFinite(duration) && duration > 0 ? duration : undefined;
  const fetched = loaded?.key === key ? loaded.source : undefined;
  const json = !inline && fetched && 'json' in fetched ? fetched.json : undefined;
  const inlineList = inline ?? (fetched && 'inline' in fetched ? fetched.inline : undefined);
  const all = useMemo(() => {
    if (json !== undefined) return parseJsonChapters(json, length);
    return inlineList ? fromInlineChapters({ inlineChapters: inlineList }, length) : [];
  }, [json, inlineList, length]);
  const chapters = useMemo(() => tocChapters(all), [all]);

  // Only these change as time passes; the returned object is derived from them.
  const { current, previous } = chapterPosition(chapters, currentTime);
  const index = lastStartedIndex(chapters, currentTime);
  const playing = current !== undefined;
  const previousIndex = previous === undefined ? -1 : previous === chapters[index] ? index : index - 1;
  const artwork = artworkAt(all, currentTime)?.img;

  return useMemo(() => ({
    chapters,
    current: playing ? chapters[index] : undefined,
    next: chapters[index + 1],
    previous: chapters[previousIndex],
    artwork,
  }), [chapters, index, playing, previousIndex, artwork]);
}
