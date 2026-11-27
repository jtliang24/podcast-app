import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import type { Episode, TranscriptRef } from '../types';
import { resolveExtras } from '../services/episodeExtras';
import { loadEpisodeExtra } from '../services/extrasCache';
import { pickTranscript, transcriptParagraphs, TRANSCRIPT_HTML_CONFIG } from '../services/transcripts';
import type { Segment } from '../services/transcripts';

export type TranscriptState =
  /** The episode has no transcript the player can show (or none is known yet). */
  | { status: 'none' }
  | { status: 'loading' }
  /** The file couldn't be fetched (and isn't cached), or had nothing readable. */
  | { status: 'error'; retry: () => void }
  /** `timed` when every paragraph has a start, so playback can follow along. */
  | { status: 'ready'; paragraphs: Segment[]; timed: boolean };

/** Fetch progress, tagged with the episode and attempt it belongs to so a stale result is never shown. */
interface Loaded {
  key: string;
  attempt: number;
  /** The transcript picked once extras are resolved; `undefined` when there is none. */
  ref?: TranscriptRef;
  /** The file's text, `null` when it couldn't be loaded; absent while loading. */
  text?: string | null;
}

const sanitizeHtml = (html: string) => DOMPurify.sanitize(html, TRANSCRIPT_HTML_CONFIG);

const episodeKey = (episode: Episode) =>
  `${episode.podcastId}\n${episode.id}\n${episode.transcripts?.map(({ url, type }) => `${url} ${type}`).join('\n') ?? '?'}`;

/**
 * The episode's transcript as paragraphs. The episode's extras are resolved (older stored copies lack them),
 * the transcript is picked for the reader's language, loaded through the per-device cache and parsed; HTML is
 * sanitized with DOMPurify. A load for an episode that is no longer current is dropped.
 *
 * While the extras of an older copy are being resolved the state is `none`, so no tab flashes for episodes
 * that turn out to have no transcript; it becomes `loading` once a transcript is known.
 */
export function useTranscript(episode: Episode | null): TranscriptState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const episodeRef = useRef(episode);
  episodeRef.current = episode;

  const key = episode ? episodeKey(episode) : null;
  // Known without loading anything: the stored episode lists transcripts, but none the player can show.
  const knownRef = episode?.transcripts && pickTranscript(episode.transcripts, navigator.language);
  const needsLoad = key !== null && (episode?.transcripts === undefined || !!knownRef);

  useEffect(() => {
    const target = episodeRef.current;
    if (!needsLoad || !target || key === null) return;
    let cancelled = false;
    (async () => {
      const resolved = await resolveExtras(target);
      if (cancelled) return;
      const ref = pickTranscript(resolved.transcripts, navigator.language);
      setLoaded({ key, attempt, ref });
      if (!ref) return;
      const text = await loadEpisodeExtra(resolved, ref);
      if (!cancelled) setLoaded({ key, attempt, ref, text });
    })();
    return () => { cancelled = true; };
  }, [key, attempt, needsLoad]);

  const current = loaded?.key === key ? loaded : undefined;
  // A retry keeps the picked transcript (so the tab stays) but shows `loading` again.
  const text = current?.attempt === attempt ? current.text : undefined;
  const type = current?.ref?.type;
  const paragraphs = useMemo(
    () => (typeof text === 'string' && type ? transcriptParagraphs(text, type, sanitizeHtml) : undefined),
    [text, type],
  );
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const known = !!knownRef || !!current?.ref;

  return useMemo((): TranscriptState => {
    if (!needsLoad || !known) return { status: 'none' };
    if (text === undefined) return { status: 'loading' };
    if (!paragraphs?.length) return { status: 'error', retry };
    return { status: 'ready', paragraphs, timed: paragraphs.every(paragraph => paragraph.start !== undefined) };
  }, [needsLoad, known, text, paragraphs, retry]);
}
