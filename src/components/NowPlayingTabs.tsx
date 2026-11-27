import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface NowPlayingTab {
  id: string;
  label: string;
  panel: ReactNode;
}

/**
 * The tabbed area under the Now Playing controls (chapters, and the transcript on narrow screens). Only tabs with content
 * should be passed; with none, nothing is shown. Follows the WAI-ARIA tabs pattern: arrow keys, Home and End
 * move between tabs, and selection follows focus.
 *
 * The selection is controlled, so the owner knows which panel is shown: `selectedId`, or the first tab when
 * it isn't among `tabs`.
 */
export default function NowPlayingTabs({ tabs, selectedId, onSelect }: {
  tabs: NowPlayingTab[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  if (!tabs.length) return null;
  const selectedIndex = Math.max(0, tabs.findIndex(tab => tab.id === selectedId));
  const selected = tabs[selectedIndex];

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowRight: selectedIndex + 1,
      ArrowLeft: selectedIndex - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const tab = tabs[(target + tabs.length) % tabs.length];
    onSelect(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  };

  return (
    <div className="w-full">
      <div role="tablist" aria-label="Episode extras" className="flex gap-2 border-b border-slate-800" onKeyDown={onKeyDown}>
        {tabs.map(tab => {
          const isSelected = tab === selected;
          return (
            <button
              key={tab.id}
              ref={element => {
                if (element) tabRefs.current.set(tab.id, element);
                else tabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`now-playing-tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={`now-playing-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold ${isSelected ? 'border-blue-400 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`now-playing-panel-${selected.id}`} aria-labelledby={`now-playing-tab-${selected.id}`} className="py-2">
        {selected.panel}
      </div>
    </div>
  );
}
