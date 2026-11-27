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
  /** The episode has a transcript, but it isn't loaded because `load` is off. */
  | { status: 'available' }
  | { status: 'loading' }
  /** The file couldn't be fetched (and isn't cached), or had nothing readable. */
  | { status: 'error'; retry: () => void }
  /** `timed` when every paragraph has a start, so playback can follow along. */
  | { status: 'ready'; paragraphs: Segment[]; timed: boolean };

/** The transcript picked once an older copy's extras are resolved, tagged with the episode it belongs to. */
interface Resolved {
  key: string;
  /** `undefined` when there is none. */
  ref?: TranscriptRef;
}

/** A loaded file, tagged with the episode and attempt it belongs to so a stale result is never shown. */
interface Fetched {
  key: string;
  attempt: number;
  type: string;
  /** The file's text, `null` when it couldn't be loaded. */
  text: string | null;
}

const sanitizeHtml = (html: string) => DOMPurify.sanitize(html, TRANSCRIPT_HTML_CONFIG);

const episodeKey = (episode: Episode) =>
  `${episode.podcastId}\n${episode.id}\n${episode.transcripts?.map(({ url, type }) => `${url} ${type}`).join('\n') ?? '?'}`;

/**
 * The episode's transcript as paragraphs. The episode's extras are resolved (older stored copies lack them)
 * and the transcript is picked for the reader's language; this alone says whether there is one. Only with
 * `load` is the file loaded through the per-device cache and parsed; HTML is sanitized with DOMPurify. A load
 * for an episode that is no longer current is dropped. A loaded transcript is kept while `load` is off, so
 * hiding and showing it again doesn't reload it.
 *
 * While the extras of an older copy are being resolved the state is `none`, so no tab flashes for episodes
 * that turn out to have no transcript; it becomes `available` (or `loading` with `load`) once one is known.
 */
export function useTranscript(episode: Episode | null, load = true): TranscriptState {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [attempt, setAttempt] = useState(0);
  const episodeRef = useRef(episode);
  episodeRef.current = episode;

  const key = episode ? episodeKey(episode) : null;
  // Known without loading anything when the stored episode lists its transcripts.
  const needsResolve = key !== null && episode?.transcripts === undefined;
  const knownRef = episode?.transcripts ? pickTranscript(episode.transcripts, navigator.language) : undefined;
  const ref = needsResolve ? (resolved?.key === key ? resolved.ref : undefined) : knownRef;

  useEffect(() => {
    const target = episodeRef.current;
    if (!needsResolve || !target || key === null) return;
    let cancelled = false;
    (async () => {
      const extras = await resolveExtras(target);
      if (!cancelled) setResolved({ key, ref: pickTranscript(extras.transcripts, navigator.language) });
    })();
    return () => { cancelled = true; };
  }, [key, needsResolve]);

  // A retry keeps the picked transcript (so the tab stays) but shows `loading` again.
  const current = fetched?.key === key && fetched.attempt === attempt ? fetched : undefined;
  const url = ref?.url;
  const type = ref?.type;
  const needsFile = load && key !== null && !current && url !== undefined && type !== undefined;

  useEffect(() => {
    const target = episodeRef.current;
    if (!needsFile || !target || key === null || url === undefined || type === undefined) return;
    let cancelled = false;
    (async () => {
      const text = await loadEpisodeExtra(target, { url, type });
      if (!cancelled) setFetched({ key, attempt, type, text });
    })();
    return () => { cancelled = true; };
  }, [key, attempt, needsFile, url, type]);

  // Parsed once per loaded file, even if the episode is hidden and shown again meanwhile.
  const paragraphs = useMemo(
    () => (typeof fetched?.text === 'string' ? transcriptParagraphs(fetched.text, fetched.type, sanitizeHtml) : undefined),
    [fetched],
  );
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const text = current?.text;
  const parsed = current ? paragraphs : undefined;

  return useMemo((): TranscriptState => {
    if (!ref) return { status: 'none' };
    if (text === undefined) return load ? { status: 'loading' } : { status: 'available' };
    if (!parsed?.length) return { status: 'error', retry };
    return { status: 'ready', paragraphs: parsed, timed: parsed.every(paragraph => paragraph.start !== undefined) };
  }, [ref, text, load, parsed, retry]);
}
