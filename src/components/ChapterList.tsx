import { memo } from 'react';
import { ExternalLink } from 'lucide-react';
import { chapterTitle } from '../services/chapters';
import type { Chapter } from '../services/chapters';

interface ChapterListProps {
  chapters: Chapter[];
  current?: Chapter;
  seek: (time: number) => void;
  formatTime: (time: number) => string;
}

/** The episode's chapters. Tapping one seeks to its start. Memoized, so it only re-renders when the chapter changes. */
function ChapterList({ chapters, current, seek, formatTime }: ChapterListProps) {
  return (
    <ol className="divide-y divide-slate-800">
      {chapters.map((chapter, index) => {
        const title = chapterTitle(chapter, index);
        const isCurrent = chapter === current;
        return (
          <li key={`${index}-${chapter.start}`} className="flex items-center gap-1">
            <button
              type="button"
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => seek(chapter.start)}
              className={`flex min-h-12 min-w-0 flex-1 items-baseline gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-800 ${isCurrent ? 'font-semibold text-blue-300' : 'text-slate-200'}`}
            >
              <span className="w-16 shrink-0 text-sm tabular-nums text-slate-400">{formatTime(chapter.start)}</span>
              <span className="min-w-0 break-words">{title}</span>
            </button>
            {chapter.url && (
              <a
                href={chapter.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open link for ${title} (opens in a new tab)`}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <ExternalLink size={18} aria-hidden="true" />
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default memo(ChapterList);
