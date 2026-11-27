import type { Episode } from '../types.ts';

/**
 * An episode chapter. Times are in seconds.
 * - `end` is when the chapter stops (see `withEndTimes`). It is `Infinity` for a last chapter whose end is unknown.
 * - `toc: false` chapters only change artwork or links during another chapter. They are left out of the chapter
 *   list and navigation (`tocChapters`) but still count for `artworkAt`.
 * - `url` and `img` are always HTTPS.
 */
export interface Chapter {
  start: number;
  end: number;
  title: string;
  url?: string;
  img?: string;
  toc: boolean;
}

/** A chapter before its end is known. `endTime` is the end the file declared, if any. */
type ChapterEntry = Omit<Chapter, 'end'> & { endTime?: number };

/** Files with more chapters than this are cut, so a broken file can't make the list unusable. */
export const MAX_CHAPTERS = 1000;
/** **Previous chapter** restarts the current chapter when playback is more than this far into it. */
export const PREVIOUS_CHAPTER_RESTART_SECONDS = 3;

/** Returns the normalized URL when it is a valid HTTPS URL, otherwise undefined. */
function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** A time in seconds: a finite number ≥ 0, or a string holding one. */
function seconds(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

/**
 * Sorts the entries by start (keeping file order for equal starts) and fills in each end:
 * - The ceiling is the next start, or the episode `duration` for the last one. A `toc` chapter's ceiling is the
 *   next `toc` chapter's start, so a `toc: false` image inside it doesn't cut it short. A `toc: false` chapter's
 *   ceiling is the next chapter of either kind.
 * - The declared `endTime` wins when it is after the start and before the ceiling. Later ends are ignored, so
 *   chapters never overlap the next one.
 * - Without a ceiling (the last chapter, duration unknown or not after its start) the declared end is used,
 *   otherwise `Infinity`.
 */
function withEndTimes(entries: ChapterEntry[], duration?: number): Chapter[] {
  const sorted = [...entries].sort((a, b) => a.start - b.start).slice(0, MAX_CHAPTERS);
  const length = duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : undefined;
  const chapters: Chapter[] = new Array(sorted.length);
  let nextStart = length;
  let nextTocStart = length;
  for (let index = sorted.length - 1; index >= 0; index--) {
    const { endTime, ...entry } = sorted[index];
    const limit = entry.toc ? nextTocStart : nextStart;
    const ceiling = limit !== undefined && limit >= entry.start ? limit : Infinity;
    const declared = endTime !== undefined && endTime > entry.start ? endTime : Infinity;
    chapters[index] = { ...entry, end: Math.min(ceiling, declared) };
    nextStart = entry.start;
    if (entry.toc) nextTocStart = entry.start;
  }
  return chapters;
}

/**
 * Parses a Podcasting 2.0 JSON chapters file. Returns `[]` when the text isn't JSON or `chapters` isn't an
 * array. Entries without a valid `startTime` are skipped, non-HTTPS `url` and `img` are dropped, and `toc`
 * defaults to true. `duration` (seconds) ends the last chapter; see `withEndTimes`.
 */
export function parseJsonChapters(text: string, duration?: number): Chapter[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = data && typeof data === 'object' ? (data as { chapters?: unknown }).chapters : undefined;
  if (!Array.isArray(list)) return [];

  const entries: ChapterEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const start = seconds(raw.startTime);
    if (start === undefined) continue;
    const endTime = seconds(raw.endTime);
    const url = httpsUrl(raw.url);
    const img = httpsUrl(raw.img);
    entries.push({
      start,
      title: typeof raw.title === 'string' ? raw.title.trim() : '',
      toc: raw.toc !== false,
      ...(endTime !== undefined && { endTime }),
      ...(url && { url }),
      ...(img && { img }),
    });
  }
  return withEndTimes(entries, duration);
}

/** Converts an episode's inline Podlove Simple Chapters. They have no end or `toc`, so all of them are listed. */
export function fromInlineChapters(episode: Pick<Episode, 'inlineChapters'>, duration?: number): Chapter[] {
  const entries: ChapterEntry[] = [];
  for (const chapter of episode.inlineChapters ?? []) {
    const start = seconds(chapter.start);
    if (start === undefined) continue;
    const url = httpsUrl(chapter.url);
    const img = httpsUrl(chapter.img);
    entries.push({ start, title: chapter.title, toc: true, ...(url && { url }), ...(img && { img }) });
  }
  return withEndTimes(entries, duration);
}

/** The chapters shown in the list and used for previous/next. */
export function tocChapters(chapters: readonly Chapter[]): Chapter[] {
  return chapters.filter(chapter => chapter.toc);
}

/** Index of the last chapter that starts at or before `time` (binary search on sorted chapters), or -1. */
export function lastStartedIndex(chapters: readonly Chapter[], time: number): number {
  let low = 0;
  let high = chapters.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (chapters[middle].start <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * The chapter playing at `time`: the last one that started, while it hasn't ended. Undefined before the first
 * chapter and in gaps left by declared end times. A chapter's start belongs to it, and its end to the next one.
 * Pass `tocChapters(...)` for the chapter to show and navigate from.
 */
export function chapterAt(chapters: readonly Chapter[], time: number): Chapter | undefined {
  const chapter = chapters[lastStartedIndex(chapters, time)];
  return chapter && time < chapter.end ? chapter : undefined;
}

/**
 * The chapter whose image to show at `time`, among all chapters including `toc: false` ones: the latest-starting
 * chapter with an `img` that is playing at `time`. So an image chapter inside a longer chapter shows while it
 * lasts, and the longer chapter's image comes back after it.
 */
export function artworkAt(chapters: readonly Chapter[], time: number): Chapter | undefined {
  for (let index = lastStartedIndex(chapters, time); index >= 0; index--) {
    const chapter = chapters[index];
    if (chapter.img && time < chapter.end) return chapter;
  }
  return undefined;
}

/** Where chapter navigation goes from `time`, given `tocChapters(...)`. */
export interface ChapterPosition {
  /** The chapter playing at `time`. */
  current?: Chapter;
  /** The next chapter to start. */
  next?: Chapter;
  /**
   * Where **Previous chapter** goes: the current chapter when more than `PREVIOUS_CHAPTER_RESTART_SECONDS` into
   * it, otherwise the chapter before it. Between chapters it is the one that last ended.
   */
  previous?: Chapter;
}

export function chapterPosition(toc: readonly Chapter[], time: number): ChapterPosition {
  const index = lastStartedIndex(toc, time);
  const started = toc[index];
  const current = started && time < started.end ? started : undefined;
  const restart = current !== undefined && time - current.start > PREVIOUS_CHAPTER_RESTART_SECONDS;
  return {
    current,
    next: toc[index + 1],
    previous: current && !restart ? toc[index - 1] : started,
  };
}

/** The title to show for the chapter at `index` in its list: its own, or `Chapter n` when the file has none. */
export function chapterTitle(chapter: Chapter, index: number): string {
  return chapter.title || `Chapter ${index + 1}`;
}
