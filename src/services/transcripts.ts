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
