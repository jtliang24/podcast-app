import type { TranscriptRef } from '../types.ts';

/** Transcript formats the player can show, by preference (lower is better). SRT has two common types. */
const FORMAT_RANK = new Map([
  ['text/vtt', 0],
  ['application/x-subrip', 1],
  ['application/srt', 1],
  ['application/json', 2],
  ['text/html', 3],
  ['text/plain', 4],
]);

/** The media type without parameters, lowercased: `Text/VTT; charset=utf-8` becomes `text/vtt`. */
export function transcriptFormat(type: string): string {
  return type.split(';')[0].trim().toLowerCase();
}

function primaryLanguage(tag: string | undefined): string | undefined {
  return tag?.split(/[-_]/)[0].trim().toLowerCase() || undefined;
}

/**
 * Picks the transcript to show: one in the reader's language first (matched on the primary subtag, so `en`
 * matches `en-US`), then by format: WebVTT, SRT, JSON, HTML, plain text. Unknown formats are never picked.
 * Ties keep feed order.
 */
export function pickTranscript(list: TranscriptRef[] | undefined, language?: string): TranscriptRef | undefined {
  const wanted = primaryLanguage(language);
  let best: TranscriptRef | undefined;
  let bestScore = Infinity;
  for (const transcript of list ?? []) {
    const rank = FORMAT_RANK.get(transcriptFormat(transcript.type));
    if (rank === undefined) continue;
    const matches = wanted !== undefined && primaryLanguage(transcript.language) === wanted;
    const score = (matches ? 0 : 10) + rank;
    if (score < bestScore) {
      best = transcript;
      bestScore = score;
    }
  }
  return best;
}

/** One piece of a transcript: a cue, or a paragraph after grouping. Times are in seconds. */
export interface Segment {
  start?: number;
  end?: number;
  speaker?: string;
  text: string;
}

/** Turns an untrusted HTML string into sanitized HTML. In the app this is DOMPurify with `TRANSCRIPT_HTML_CONFIG`. */
export type HtmlSanitizer = (html: string) => string;

/**
 * The DOMPurify settings for HTML transcripts: only the tags that carry transcript structure, and no
 * attributes except `datetime` on `<time>` (DOMPurify drops event handlers, links and scripts).
 */
export const TRANSCRIPT_HTML_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'cite', 'time', 'span'],
  ALLOWED_ATTR: ['datetime'],
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

/** Decodes character references (`&amp;`, `&#39;`, `&#x27;`...) as text, without touching the DOM. Unknown ones are kept. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== '#') return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return valid ? String.fromCodePoint(code) : '�';
  });
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** `HH:MM:SS.mmm`, `MM:SS.mmm` or `M:SS`, with `.` or `,` before the fraction, in seconds. */
export function parseTimestamp(value: string): number | undefined {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d+))?$/.exec(value.trim());
  if (!match) return undefined;
  const [, hours, minutes, seconds, fraction] = match;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0);
}

/** A `<time datetime>` value: a timestamp, or an ISO 8601 duration such as `PT1M2.5S`. */
function parseDatetime(value: string): number | undefined {
  const timestamp = parseTimestamp(value);
  if (timestamp !== undefined) return timestamp;
  const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value.trim());
  if (!match || match[0].length <= 2) return undefined;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

const byStart = (segments: Segment[]) => segments.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

/**
 * WebVTT (`vtt`) or SRT cues. Blocks are separated by blank lines; a block is a cue when it has a
 * `start --> end` line, so the WebVTT header, `NOTE`, `STYLE` and `REGION` blocks, cue ids, SRT counters and
 * cue settings are skipped. `<v Speaker>` (also `<v.class Speaker>`) sets the speaker; other tags, SRT
 * `{\an8}` overrides and blank cues are removed. A cue with lines from several voices becomes one segment each.
 */
function parseCues(text: string, vtt: boolean): Segment[] {
  const segments: Segment[] = [];
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
  for (const block of blocks) {
    const lines = block.split('\n');
    if (vtt && /^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(lines[0].trim())) continue;
    const timing = lines.findIndex(line => line.includes('-->'));
    if (timing < 0) continue;
    const [from, rest] = lines[timing].split('-->');
    const start = parseTimestamp(from);
    const end = parseTimestamp(rest.trim().split(/\s+/)[0] ?? '');
    if (start === undefined || end === undefined) continue;
    let speaker: string | undefined;
    let current: Segment | undefined;
    for (const line of lines.slice(timing + 1)) {
      const voice = vtt ? /<v(?:\.[^\s>]*)?(?:\s+([^>]*))?>/.exec(line) : null;
      if (voice) speaker = collapse(decodeEntities(voice[1] ?? '')) || undefined;
      const words = collapse(decodeEntities(line.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '')));
      if (!words) continue;
      if (current && current.speaker === speaker) current.text += ` ${words}`;
      else {
        current = { start, end, ...(speaker ? { speaker } : {}), text: words };
        segments.push(current);
      }
    }
  }
  return byStart(segments);
}

const seconds = (value: unknown) => {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : undefined;
};

/** A Podcasting 2.0 JSON transcript: `{ segments: [{ speaker, startTime, endTime, body }] }`. Invalid entries are skipped. */
function parseJsonTranscript(text: string): Segment[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : (data as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(list)) return [];
  const segments: Segment[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { speaker, startTime, endTime, body } = item as Record<string, unknown>;
    const words = typeof body === 'string' ? collapse(body) : '';
    const start = seconds(startTime);
    if (!words || start === undefined) continue;
    const end = seconds(endTime);
    const name = typeof speaker === 'string' ? collapse(speaker) : '';
    segments.push({ start, ...(end !== undefined && end >= start ? { end } : {}), ...(name ? { speaker: name } : {}), text: words });
  }
  return byStart(segments);
}

/** Elements whose content is never transcript text, should any survive sanitizing. */
const DROPPED_CONTENT = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'svg', 'math', 'textarea', 'title', 'head']);

/**
 * An HTML transcript, sanitized with `sanitize` first and then read as text only: the result never contains
 * markup. Paragraphs come from `<p>` (or `<br><br>`). A `<cite>` names the speaker of what follows (a trailing
 * colon is dropped) and a `<time>` (its `datetime`, or its text, e.g. `1:02`) sets the next paragraph's start.
 * Timed paragraphs without an end get the next one's start.
 */
export function parseHtmlTranscript(html: string, sanitize: HtmlSanitizer): Segment[] {
  const clean = sanitize(html);
  const segments: Segment[] = [];
  let text = '';
  let speaker: string | undefined;
  let start: number | undefined;
  let inside: 'cite' | 'time' | undefined;
  let captured = '';
  let datetime: number | undefined;
  let dropped: { tag: string; depth: number } | undefined;
  let lastWasBreak = false;

  const flush = () => {
    const words = collapse(text);
    text = '';
    if (!words) return;
    segments.push({ ...(start !== undefined ? { start } : {}), ...(speaker ? { speaker } : {}), text: words });
    start = undefined;
  };

  const tokens = /<!--[\s\S]*?-->|<(\/?)([a-z][\w-]*)([^>]*)>|([^<]+)|</gi;
  for (let match = tokens.exec(clean); match; match = tokens.exec(clean)) {
    const [token, closing, rawTag, attributes, rawText] = match;
    const tag = rawTag?.toLowerCase();
    if (dropped) {
      if (tag === dropped.tag) dropped.depth += closing ? -1 : 1;
      if (dropped.depth === 0) dropped = undefined;
      continue;
    }
    if (rawText !== undefined || token === '<') {
      const decoded = rawText === undefined ? '<' : decodeEntities(rawText);
      if (inside) captured += decoded;
      else text += decoded;
      if (decoded.trim()) lastWasBreak = false;
      continue;
    }
    if (!tag) continue; // A comment.
    if (DROPPED_CONTENT.has(tag) && !closing && !attributes.trim().endsWith('/')) {
      dropped = { tag, depth: 1 };
    } else if (tag === 'p') {
      flush();
    } else if (tag === 'br') {
      if (lastWasBreak) flush();
      else text += ' ';
      lastWasBreak = !lastWasBreak;
      continue;
    } else if ((tag === 'cite' || tag === 'time') && !closing) {
      inside = tag;
      captured = '';
      const value = tag === 'time' ? /\bdatetime\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes) : null;
      datetime = value ? parseDatetime(decodeEntities(value[1] ?? value[2] ?? value[3])) : undefined;
    } else if (tag === inside && closing) {
      const value = collapse(captured);
      if (inside === 'cite') speaker = value.replace(/\s*:$/, '') || speaker;
      else start = datetime ?? parseTimestamp(value) ?? start;
      inside = undefined;
    }
    lastWasBreak = false;
  }
  flush();

  let next: number | undefined;
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    if (segment.start === undefined) continue;
    if (next !== undefined && next >= segment.start) segment.end = next;
    next = segment.start;
  }
  return segments;
}

/** Plain text, split into paragraphs at blank lines (or at every line break when there are none). Untimed. */
function parsePlainText(text: string): Segment[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const parts = /\n[ \t]*\n/.test(normalized) ? normalized.split(/\n[ \t]*\n/) : normalized.split('\n');
  return parts.map(collapse).filter(Boolean).map(part => ({ text: part }));
}

/**
 * Parses a transcript file of the given media type into segments. Unknown types give none. HTML is passed
 * through `sanitizeHtml` (the app uses DOMPurify) and then reduced to text.
 */
export function parseTranscript(text: string, type: string, sanitizeHtml: HtmlSanitizer = html => html): Segment[] {
  switch (transcriptFormat(type)) {
    case 'text/vtt': return parseCues(text, true);
    case 'application/x-subrip':
    case 'application/srt': return parseCues(text, false);
    case 'application/json': return parseJsonTranscript(text);
    case 'text/html': return parseHtmlTranscript(text, sanitizeHtml);
    case 'text/plain': return parsePlainText(text);
    default: return [];
  }
}

/** Grouping limits: a new paragraph starts after a pause this long or once a paragraph would run longer. */
export const PARAGRAPH_GAP = 2;
export const PARAGRAPH_LENGTH = 30;

/**
 * Joins timed cues into readable paragraphs: consecutive cues by the same speaker (or both without one) stay
 * together while the pause between them is under 2 s and the paragraph spans at most about 30 s. Untimed
 * segments pass through unchanged and end the paragraph before them. The input is not modified.
 */
export function groupSegments(segments: readonly Segment[]): Segment[] {
  const paragraphs: Segment[] = [];
  let current: Segment | undefined;
  for (const segment of segments) {
    if (segment.start === undefined) {
      paragraphs.push(segment);
      current = undefined;
      continue;
    }
    const end = segment.end ?? segment.start;
    if (
      current?.start !== undefined
      && current.speaker === segment.speaker
      && segment.start - (current.end ?? current.start) < PARAGRAPH_GAP
      && end - current.start <= PARAGRAPH_LENGTH
    ) {
      current.text += ` ${segment.text}`;
      current.end = Math.max(current.end ?? current.start, end);
    } else {
      current = { ...segment };
      paragraphs.push(current);
    }
  }
  return paragraphs;
}

/**
 * The paragraphs to show for a transcript file. Caption formats (WebVTT, SRT, JSON) are grouped with
 * `groupSegments`; HTML and plain text already come in paragraphs.
 */
export function transcriptParagraphs(text: string, type: string, sanitizeHtml?: HtmlSanitizer): Segment[] {
  const segments = parseTranscript(text, type, sanitizeHtml);
  const format = transcriptFormat(type);
  return format === 'text/html' || format === 'text/plain' ? segments : groupSegments(segments);
}

/** The index of the last paragraph that started at or before `time` (paragraphs sorted by start), or -1. */
export function activeParagraph(paragraphs: readonly Segment[], time: number): number {
  let low = 0;
  let high = paragraphs.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((paragraphs[middle].start ?? 0) <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** A search hit: the paragraph index and the `[start, end)` character range in its text. */
export interface TranscriptMatch {
  paragraph: number;
  start: number;
  end: number;
}

/** Every case-insensitive occurrence of `query` (trimmed) in the paragraphs, in reading order. */
export function findMatches(paragraphs: readonly Segment[], query: string): TranscriptMatch[] {
  const needle = query.trim();
  if (!needle) return [];
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const matches: TranscriptMatch[] = [];
  paragraphs.forEach(({ text }, paragraph) => {
    for (const match of text.matchAll(pattern)) {
      matches.push({ paragraph, start: match.index, end: match.index + match[0].length });
    }
  });
  return matches;
}
