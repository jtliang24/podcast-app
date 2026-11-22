import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowUp, ArrowUpToLine, GripVertical, Play, Podcast as PodcastIcon, Trash2 } from 'lucide-react';
import type { Episode, EpisodeQueue, Podcast, QueueTier } from '../types';

const tiers = { primary: 'Primary Queue', secondary: 'Secondary Queue' } as const;
const control = 'grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-300 enabled:hover:bg-slate-700 enabled:hover:text-white disabled:opacity-30';

interface DropTarget {
  tier: QueueTier;
  beforeId?: string;
}

function getDropTarget(x: number, y: number): DropTarget | null {
  const element = document.elementFromPoint(x, y);
  const tier = element?.closest<HTMLElement>('[data-queue-tier]')?.dataset.queueTier;
  if (tier !== 'primary' && tier !== 'secondary') return null;
  const row = element?.closest<HTMLElement>('[data-queue-episode]');
  if (!row) return { tier };
  const bounds = row.getBoundingClientRect();
  const before = y < bounds.top + bounds.height / 2 ? row : row.nextElementSibling;
  return { tier, beforeId: (before as HTMLElement | null)?.dataset.queueEpisode };
}

interface Drag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moving: boolean;
  frame: number;
}

export default function QueueView({ queue, currentEpisode, podcasts, onBack, onMove, onPlay, onRemove }: {
  queue: EpisodeQueue;
  currentEpisode: Episode | null;
  podcasts: Podcast[];
  onBack: () => void;
  onMove: (id: string, tier: QueueTier, beforeId?: string) => void;
  onPlay: (episode: Episode) => void;
  onRemove: (id: string) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const focusAfterMove = useRef<{ id: string; tier: QueueTier; control: string } | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (drag.current) cancelAnimationFrame(drag.current.frame);
    };
  }, []);

  useEffect(() => {
    const target = focusAfterMove.current;
    if (!target) return;
    const row = view.current?.querySelector(`[data-queue-tier="${target.tier}"] [data-queue-episode="${CSS.escape(target.id)}"]`);
    if (row) {
      focusAfterMove.current = null;
      row.querySelector<HTMLButtonElement>(target.control)?.focus();
    }
  }, [queue]);

  const startDrag = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    const { pointerId, clientX: x, clientY: y } = event;
    event.currentTarget.setPointerCapture(pointerId);
    drag.current = { id, pointerId, startX: x, startY: y, x, y, moving: false, frame: 0 };
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.x = event.clientX;
    active.y = event.clientY;
    if (active.moving || Math.hypot(active.x - active.startX, active.y - active.startY) < 5) return;
    active.moving = true;
    const update = () => {
      if (drag.current !== active) return;
      const bottom = document.getElementById('player-bar')?.getBoundingClientRect().top ?? window.innerHeight;
      if (active.y < 48) window.scrollBy(0, -12);
      else if (active.y > bottom - 48) window.scrollBy(0, 12);
      const target = getDropTarget(active.x, active.y);
      setDrop(previous => previous?.tier === target?.tier && previous?.beforeId === target?.beforeId ? previous : target);
      active.frame = requestAnimationFrame(update);
    };
    update();
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>, commit: boolean) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    cancelAnimationFrame(active.frame);
    setDrop(null);
    if (commit && active.moving) {
      const target = getDropTarget(event.clientX, event.clientY);
      if (target) onMove(active.id, target.tier, target.beforeId);
    }
  };

  const moveBetweenTiers = (id: string, tier: QueueTier, control: string) => {
    focusAfterMove.current = { id, tier, control };
    onMove(id, tier);
  };

  const moveWithKeys = (event: KeyboardEvent<HTMLButtonElement>, tier: QueueTier, index: number) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const episodes = queue[tier];
    const id = episodes[index].id;
    const up = event.key === 'ArrowUp';
    if (event.shiftKey) {
      const destination = up ? 'primary' : 'secondary';
      if (destination !== tier) moveBetweenTiers(id, destination, '[data-drag-handle]');
    } else if (up ? index > 0 : index < episodes.length - 1) {
      onMove(id, tier, episodes[index + (up ? -1 : 2)]?.id);
    }
  };

  const episodeInfo = (episode: Episode) => {
    const podcast = podcasts.find(item => item.feedUrl === episode.podcastId);
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {podcast?.artworkUrl ? (
          <img src={podcast.artworkUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-slate-800 text-slate-400">
            <PodcastIcon size={20} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-slate-100">{episode.title}</p>
          {podcast && <p className="truncate text-xs text-slate-400">{podcast.title}</p>}
        </div>
      </div>
    );
  };

  return (
    <div ref={view} className="mx-auto max-w-3xl space-y-7">
      <div>
        <button type="button" onClick={onBack} className="mb-3 flex min-h-11 items-center gap-2 rounded text-sm font-semibold text-slate-300 hover:text-white">
          <ArrowLeft size={18} aria-hidden="true" /> Back
        </button>
        <h1 ref={heading} tabIndex={-1} className="text-3xl font-black focus:outline-none">Queue</h1>
        <p id="queue-keyboard-move" className="sr-only">Use Up and Down to reorder. Hold Shift to move between queues.</p>
      </div>

      <section aria-labelledby="queue-now-playing">
        <h2 id="queue-now-playing" className="mb-2 text-lg font-bold">Now Playing</h2>
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
          {currentEpisode ? episodeInfo(currentEpisode) : <p className="text-sm text-slate-400">No episode selected</p>}
        </div>
      </section>

      {(['primary', 'secondary'] as const).map(tier => {
        const episodes = queue[tier];
        const other = tier === 'primary' ? 'secondary' : 'primary';
        const TierIcon = tier === 'primary' ? ArrowDownToLine : ArrowUpToLine;
        const dropping = drop?.tier === tier;
        return (
          <section key={tier} data-queue-tier={tier} aria-labelledby={`${tier}-queue-heading`}>
            <h2 id={`${tier}-queue-heading`} className="mb-2 text-lg font-bold">{tiers[tier]}</h2>
            <div className={`rounded-xl border bg-slate-900 p-2 ${dropping && !drop.beforeId ? 'border-blue-400' : 'border-slate-800'}`}>
              {episodes.length ? (
                <ol className="space-y-1">
                  {episodes.map((episode, index) => (
                    <li key={episode.id} data-queue-episode={episode.id} className={`flex flex-wrap items-center rounded-lg border p-1 sm:flex-nowrap ${dropping && drop.beforeId === episode.id ? 'border-t-blue-400' : 'border-t-transparent'} border-x-transparent border-b-transparent bg-slate-800/60`}>
                      <button type="button" data-drag-handle aria-label={`Reorder ${episode.title}`}
                        aria-describedby="queue-keyboard-move" aria-keyshortcuts="ArrowUp ArrowDown Shift+ArrowUp Shift+ArrowDown"
                        className={`${control} touch-none cursor-grab active:cursor-grabbing`}
                        onKeyDown={event => moveWithKeys(event, tier, index)}
                        onPointerDown={event => startDrag(event, episode.id)} onPointerMove={moveDrag}
                        onPointerUp={event => endDrag(event, true)} onPointerCancel={event => endDrag(event, false)}
                        onLostPointerCapture={event => endDrag(event, false)}>
                        <GripVertical size={19} aria-hidden="true" />
                      </button>
                      {episodeInfo(episode)}
                      <div className="flex w-full justify-end sm:w-auto">
                        <button type="button" className={control} title="Play" aria-label={`Play ${episode.title}`} onClick={() => onPlay(episode)}>
                          <Play size={17} aria-hidden="true" />
                        </button>
                        <button type="button" className={control} title="Move up" aria-label={`Move ${episode.title} up`}
                          disabled={index === 0} onClick={() => onMove(episode.id, tier, episodes[index - 1]?.id)}>
                          <ArrowUp size={17} aria-hidden="true" />
                        </button>
                        <button type="button" className={control} title="Move down" aria-label={`Move ${episode.title} down`}
                          disabled={index === episodes.length - 1} onClick={() => onMove(episode.id, tier, episodes[index + 2]?.id)}>
                          <ArrowDown size={17} aria-hidden="true" />
                        </button>
                        <button type="button" data-move-tier className={control} title={`Move to ${tiers[other]}`}
                          aria-label={`Move ${episode.title} to ${tiers[other]}`}
                          onClick={() => moveBetweenTiers(episode.id, other, '[data-move-tier]')}>
                          <TierIcon size={17} aria-hidden="true" />
                        </button>
                        <button type="button" className={control} title="Remove from queue"
                          aria-label={`Remove ${episode.title} from queue`} onClick={() => onRemove(episode.id)}>
                          <Trash2 size={17} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="px-3 py-5 text-sm text-slate-400">No episodes queued</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
