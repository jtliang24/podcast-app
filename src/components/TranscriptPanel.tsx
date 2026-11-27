import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { ChevronDown, ChevronUp, Loader2, LocateFixed } from 'lucide-react';
import { activeParagraph, findMatches } from '../services/transcripts';
import type { Segment, TranscriptMatch } from '../services/transcripts';
import type { TranscriptState } from '../hooks/useTranscript';

/**
 * How long after the reader scrolls the transcript stops following playback. Going to a search match stops it
 * until the search is cleared or **Jump to current** is pressed.
 */
const FOLLOW_PAUSE_MS = 5000;
/** Keys that scroll the transcript when it (or a row in it) has focus. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

interface TranscriptPanelProps {
  /** `available` (not loaded yet) shows as loading. */
  transcript: Exclude<TranscriptState, { status: 'none' }>;
  /** With `seek`, a timed transcript follows playback and tapping a paragraph seeks to it. */
  currentTime?: number;
  seek?: (time: number) => void;
  formatTime: (time: number) => string;
  /** Sizes the panel; the paragraphs scroll inside it. */
  className?: string;
}

interface RowProps {
  index: number;
  paragraph: Segment;
  active: boolean;
  showSpeaker: boolean;
  /** This paragraph's search matches, and the selected one when it is here. */
  matches?: TranscriptMatch[];
  currentMatch?: TranscriptMatch;
  formatTime: (time: number) => string;
  onSelect?: (time: number) => void;
}

function highlight(text: string, matches: TranscriptMatch[] | undefined, currentMatch: TranscriptMatch | undefined): ReactNode {
  if (!matches?.length) return text;
  const parts: ReactNode[] = [];
  let position = 0;
  for (const match of matches) {
    if (match.start > position) parts.push(text.slice(position, match.start));
    const isCurrent = match === currentMatch;
    parts.push(
      <mark
        key={match.start}
        data-current={isCurrent || undefined}
        className={`rounded-sm px-0.5 text-slate-950 ${isCurrent ? 'bg-amber-300 ring-2 ring-amber-300' : 'bg-amber-200/70'}`}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );
    position = match.end;
  }
  parts.push(text.slice(position));
  return parts;
}

/**
 * One paragraph. Memoized: as playback moves on, only the rows that become or stop being active re-render,
 * and `content-visibility: auto` lets the browser skip laying out rows that are off screen.
 */
const TranscriptRow = memo(function TranscriptRow({ index, paragraph, active, showSpeaker, matches, currentMatch, formatTime, onSelect }: RowProps) {
  const { start, speaker, text } = paragraph;
  const seekable = onSelect !== undefined && start !== undefined;
  const time = start !== undefined ? formatTime(start) : undefined;
  return (
    <li
      data-paragraph={index}
      aria-current={active ? 'true' : undefined}
      onClick={seekable ? () => {
        // Selecting text to copy it is not a tap.
        if (window.getSelection()?.isCollapsed !== false) onSelect(start);
      } : undefined}
      className={`rounded-lg px-3 py-2 [contain-intrinsic-size:auto_5rem] [content-visibility:auto] ${seekable ? 'cursor-pointer hover:bg-slate-800/60' : ''} ${active ? 'bg-slate-800 text-white' : 'text-slate-300'}`}
    >
      {(showSpeaker || seekable) && (
        <div className="mb-0.5 flex items-baseline gap-2 text-xs">
          {showSpeaker && <span className="font-semibold text-blue-300">{speaker}</span>}
          {seekable && (
            <button
              type="button"
              aria-label={`Play from ${time}`}
              onClick={event => {
                event.stopPropagation();
                onSelect(start);
              }}
              className="rounded tabular-nums text-slate-400 hover:text-white hover:underline"
            >
              {time}
            </button>
          )}
        </div>
      )}
      <p className="break-words leading-relaxed">{highlight(text, matches, currentMatch)}</p>
    </li>
  );
});

interface RowsProps {
  paragraphs: Segment[];
  active: number;
  showSpeaker: boolean[];
  matchesByParagraph: Map<number, TranscriptMatch[]>;
  currentMatch?: TranscriptMatch;
  formatTime: (time: number) => string;
  onSelect?: (time: number) => void;
}

/** The paragraph list. Memoized so time updates that don't change the active paragraph don't touch it. */
const TranscriptRows = memo(function TranscriptRows({ paragraphs, active, showSpeaker, matchesByParagraph, currentMatch, formatTime, onSelect }: RowsProps) {
  return (
    <ol role="list" className="space-y-1">
      {paragraphs.map((paragraph, index) => (
        <TranscriptRow
          key={index}
          index={index}
          paragraph={paragraph}
          active={index === active}
          showSpeaker={showSpeaker[index]}
          matches={matchesByParagraph.get(index)}
          currentMatch={currentMatch?.paragraph === index ? currentMatch : undefined}
          formatTime={formatTime}
          onSelect={onSelect}
        />
      ))}
    </ol>
  );
});

/**
 * Scrolls `container` (never the page) so `target` sits a third of the way down. Instant scrolls are
 * corrected once on the next frame, since rows skipped by `content-visibility` only get their real height
 * when they come into view.
 */
function scrollWithin(container: HTMLElement, find: () => HTMLElement | null, smooth: boolean) {
  const apply = (behavior: ScrollBehavior) => {
    const target = find();
    if (!target || container.clientHeight === 0) return;
    let top = 0;
    for (let element: HTMLElement | null = target; element && element !== container; element = element.offsetParent as HTMLElement | null) {
      top += element.offsetTop;
    }
    const offset = Math.max(0, (container.clientHeight - target.offsetHeight) / 3);
    container.scrollTo({ top: Math.max(0, top - offset), behavior });
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (smooth && !reduced) {
    apply('smooth');
  } else {
    apply('auto');
    requestAnimationFrame(() => apply('auto'));
  }
}

function TranscriptView({ paragraphs, timed, currentTime, seek, formatTime }: {
  paragraphs: Segment[];
  timed: boolean;
  currentTime?: number;
  seek?: (time: number) => void;
  formatTime: (time: number) => string;
}) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  // The reader scrolled (or searched) recently, so playback is not followed until `FOLLOW_PAUSE_MS` passes.
  const [paused, setPaused] = useState(false);
  // The reader went to a search match, so playback is not followed while the search is active.
  const [searchHold, setSearchHold] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pauseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seekRef = useRef(seek);
  seekRef.current = seek;

  const synced = timed && currentTime !== undefined && seek !== undefined;
  const active = synced ? activeParagraph(paragraphs, currentTime) : -1;
  const following = synced && !paused && !searchHold;
  const followRef = useRef({ active, following });
  followRef.current = { active, following };

  const showSpeaker = useMemo(
    () => paragraphs.map((paragraph, index) => !!paragraph.speaker && paragraph.speaker !== paragraphs[index - 1]?.speaker),
    [paragraphs],
  );
  const matches = useMemo(() => findMatches(paragraphs, query), [paragraphs, query]);
  const matchesByParagraph = useMemo(() => {
    const map = new Map<number, TranscriptMatch[]>();
    for (const match of matches) {
      const list = map.get(match.paragraph);
      if (list) list.push(match);
      else map.set(match.paragraph, [match]);
    }
    return map;
  }, [matches]);
  const currentMatch = matches.length ? matches[Math.min(matchIndex, matches.length - 1)] : undefined;

  const pauseFollowing = useCallback(() => {
    setPaused(true);
    clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(() => setPaused(false), FOLLOW_PAUSE_MS);
  }, []);
  const resumeFollowing = useCallback(() => {
    clearTimeout(pauseTimer.current);
    setPaused(false);
    setSearchHold(false);
  }, []);
  useEffect(() => () => clearTimeout(pauseTimer.current), []);

  const scrollToParagraph = useCallback((index: number, smooth: boolean) => {
    const container = containerRef.current;
    if (container) scrollWithin(container, () => container.querySelector<HTMLElement>(`[data-paragraph="${index}"]`), smooth);
  }, []);

  // Follow playback. The first scroll (and the one after the panel is shown or resized) is instant.
  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (!following || active < 0) return;
    scrollToParagraph(active, scrolledOnce.current);
    scrolledOnce.current = true;
  }, [active, following, scrollToParagraph]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const { active: index, following: follow } = followRef.current;
      if (follow && index >= 0) scrollToParagraph(index, false);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollToParagraph]);

  // Going to a search match pauses following until the search is cleared, so the reader can stay on it.
  useEffect(() => {
    const container = containerRef.current;
    if (!currentMatch || !container) return;
    setSearchHold(true);
    scrollWithin(container, () => container.querySelector<HTMLElement>('mark[data-current]'), false);
  }, [currentMatch]);

  const onSelect = useCallback((time: number) => {
    resumeFollowing();
    seekRef.current?.(time);
  }, [resumeFollowing]);

  const step = (delta: number) => {
    if (!matches.length || !currentMatch) return;
    const index = matches.indexOf(currentMatch);
    setMatchIndex((index + delta + matches.length) % matches.length);
  };
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    step(event.shiftKey ? -1 : 1);
  };
  const onScrollKey = (event: KeyboardEvent) => {
    if (SCROLL_KEYS.has(event.key)) pauseFollowing();
  };

  const searching = query.trim() !== '';
  const position = currentMatch ? matches.indexOf(currentMatch) + 1 : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="search" className="flex items-center gap-1 pb-2">
        <label htmlFor={searchId} className="sr-only">Search transcript</label>
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder="Search transcript"
          autoComplete="off"
          onChange={event => {
            const value = event.currentTarget.value;
            setQuery(value);
            setMatchIndex(0);
            if (!value.trim()) setSearchHold(false);
          }}
          onKeyDown={onSearchKey}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
        />
        <span aria-live="polite" className="min-w-[4.5rem] text-center text-xs tabular-nums text-slate-400">
          {searching && (matches.length ? `${position} of ${matches.length}` : 'No matches')}
        </span>
        <button type="button" aria-label="Previous match" disabled={matches.length === 0} onClick={() => step(-1)} className="grid h-10 w-10 place-items-center rounded-full text-slate-300 enabled:hover:bg-slate-800 enabled:hover:text-white disabled:opacity-30">
          <ChevronUp size={20} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Next match" disabled={matches.length === 0} onClick={() => step(1)} className="grid h-10 w-10 place-items-center rounded-full text-slate-300 enabled:hover:bg-slate-800 enabled:hover:text-white disabled:opacity-30">
          <ChevronDown size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          role="region"
          aria-label="Transcript text"
          tabIndex={0}
          onWheel={pauseFollowing}
          onTouchMove={pauseFollowing}
          onKeyDown={onScrollKey}
          onPointerDown={event => {
            // A press on the container itself (not a row) is its scrollbar.
            if (event.target === event.currentTarget) pauseFollowing();
          }}
          className="relative h-full overflow-y-auto overscroll-contain rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
        >
          <TranscriptRows
            paragraphs={paragraphs}
            active={active}
            showSpeaker={showSpeaker}
            matchesByParagraph={matchesByParagraph}
            currentMatch={currentMatch}
            formatTime={formatTime}
            onSelect={synced ? onSelect : undefined}
          />
        </div>
        {synced && (paused || searchHold) && active >= 0 && (
          <button
            type="button"
            onClick={resumeFollowing}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-blue-500"
          >
            <LocateFixed size={16} aria-hidden="true" />
            Jump to current
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The episode transcript: loading and error states, then the paragraphs with search. A timed transcript
 * given `currentTime` and `seek` highlights and follows the paragraph playing now; untimed ones are plain text.
 */
export default function TranscriptPanel({ transcript, currentTime, seek, formatTime, className = '' }: TranscriptPanelProps) {
  if (transcript.status === 'loading' || transcript.status === 'available') {
    return (
      <p role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
        <Loader2 size={18} className="animate-spin" aria-hidden="true" />
        Loading transcript…
      </p>
    );
  }
  if (transcript.status === 'error') {
    return (
      <p className="py-8 text-center text-sm text-slate-400">
        Couldn’t load the transcript.
        <button type="button" onClick={transcript.retry} className="ml-2 font-bold text-slate-200 underline">Try again</button>
      </p>
    );
  }
  return (
    <div className={className}>
      <TranscriptView
        paragraphs={transcript.paragraphs}
        timed={transcript.timed}
        currentTime={currentTime}
        seek={seek}
        formatTime={formatTime}
      />
    </div>
  );
}
