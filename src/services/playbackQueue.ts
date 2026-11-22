import { INITIAL_STATE } from '../types.ts';
import type { AppState, Episode, EpisodeQueue, QueueAction, QueueTier } from '../types.ts';

export type StateSnapshot = Omit<Partial<AppState>, 'queue'> & {
  queue?: EpisodeQueue | Episode[];
};

export function orderedQueue(queue: EpisodeQueue): Episode[] {
  return [...queue.primary, ...queue.secondary];
}

export function nextEpisode(queue: EpisodeQueue): Episode | null {
  return orderedQueue(queue)[0] ?? null;
}

export function removeQueuedEpisode(queue: EpisodeQueue, id: string): EpisodeQueue {
  const withoutEpisode = (tier: Episode[]) => tier.some(episode => episode.id === id)
    ? tier.filter(episode => episode.id !== id) : tier;
  const primary = withoutEpisode(queue.primary);
  const secondary = withoutEpisode(queue.secondary);
  return primary === queue.primary && secondary === queue.secondary ? queue : { primary, secondary };
}

export function normalizeState(snapshot: StateSnapshot): AppState {
  const { queue, ...fields } = snapshot;
  const state = { ...INITIAL_STATE, ...fields, queue: normalizeQueue(queue) };
  if (Array.isArray(queue) && state.lastPlayingEpisode) {
    state.queue = removeQueuedEpisode(state.queue, state.lastPlayingEpisode.id);
  }
  return state;
}

export function normalizeQueue(queue: StateSnapshot['queue']): EpisodeQueue {
  return Array.isArray(queue) ? { primary: [], secondary: queue } : queue ?? INITIAL_STATE.queue;
}

function insertEpisode(queue: EpisodeQueue, episode: Episode, tier: QueueTier, beforeId?: string): EpisodeQueue {
  const remaining = removeQueuedEpisode(queue, episode.id);
  const destination = remaining[tier];
  const before = destination.findIndex(item => item.id === beforeId);
  const index = before < 0 ? destination.length : before;
  const other = tier === 'primary' ? 'secondary' : 'primary';
  if (remaining[other] === queue[other] && queue[tier][index]?.id === episode.id) return queue;
  return { ...remaining, [tier]: [...destination.slice(0, index), episode, ...destination.slice(index)] };
}

export function queueEpisode(queue: EpisodeQueue, episode: Episode, action: QueueAction): EpisodeQueue {
  const tier = action === 'add-to-queue' ? 'secondary' : 'primary';
  const before = action === 'play-next' ? queue.primary.find(item => item.id !== episode.id)?.id : undefined;
  return insertEpisode(queue, episode, tier, before);
}

export function moveQueuedEpisode(queue: EpisodeQueue, id: string, tier: QueueTier, beforeId?: string): EpisodeQueue {
  if (id === beforeId) return queue;
  const episode = queue.primary.find(item => item.id === id) ?? queue.secondary.find(item => item.id === id);
  return episode ? insertEpisode(queue, episode, tier, beforeId) : queue;
}
