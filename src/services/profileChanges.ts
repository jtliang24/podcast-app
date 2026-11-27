import type { AppState, Episode, Podcast } from '../types.ts';
import { normalizeQueue, normalizeState, orderedQueue } from './playbackQueue.ts';
import type { StateSnapshot } from './playbackQueue.ts';

export const routineUploadInterval = 30_000;

const maps = [
  'playbackProgress', 'podcastSortOrders', 'playedEpisodes', 'hidePlayedEpisodes',
  'podcastReleaseDates', 'podcastLastPlayed',
] as const;
const fields = [
  'queue', 'newReleases', 'lastRefresh', 'lastPlayingEpisode',
  'cellularDownload', 'autoDownloadQueued', 'autoRemoveFinishedDownloads', 'skipBackwardSeconds', 'skipForwardSeconds',
  'subscriptionSortField', 'subscriptionSortDirection',
] as const;
type MapField = typeof maps[number];
type ScalarField = typeof fields[number];
type NonQueueField = Exclude<ScalarField, 'queue'>;

type Change =
  | { field: 'subscriptions'; key: string; value?: Podcast }
  | { field: 'episodeMetadata'; key: string; value: Episode }
  | { field: 'sessionUrl'; key?: never; value: string }
  | { [K in MapField]: { field: K; key: string; value?: NonNullable<AppState[K]>[string] } }[MapField]
  | { field: 'queue'; key?: never; value?: StateSnapshot['queue'] }
  | { [K in NonQueueField]: { field: K; key?: never; value?: AppState[K] } }[NonQueueField];

interface Stamp {
  time: number;
  device: string;
}

export interface Batch extends Stamp {
  id: string;
  changes: Change[];
}

export type StateUpdate = AppState | ((state: AppState) => AppState);
export interface Profile {
  state: AppState;
  seeded: boolean;
  clock: number;
  versions: Record<string, Stamp>;
  applied: Record<string, true>;
  pending: { batch: Batch; urgent: boolean; fileId?: string; checkpoint?: string; due?: number }[];
  legacyQueue?: Episode[];
  episodes?: Record<string, Episode>;
  sessionUrl?: string;
  lastCheckpointUpload?: Record<string, number>;
  fileIds?: string[];
  feed?: { token: string; scanPage?: string };
  initialPullComplete?: boolean;
  lastPull?: number;
  pullLease?: { owner: string; until: number };
  pullRetryAt?: number;
}

export function newProfile(snapshot?: StateSnapshot): Profile {
  return { state: normalizeState(snapshot ?? {}), seeded: !!snapshot, clock: 0, versions: {}, applied: {}, pending: [] };
}

function diffEntries<K extends MapField | 'subscriptions'>(
  field: K, before: Record<string, unknown>, after: Record<string, unknown>, changes: Change[],
) {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] !== after[key]) {
      // Both records come from the same typed AppState field.
      changes.push({ field, key, value: Object.hasOwn(after, key) ? after[key] : undefined } as Change);
    }
  }
}

export function recordEdit(profile: Profile, update: StateUpdate, device: string, urgent = false, now = Date.now(), routine = false) {
  const before = profile.state;
  const after = typeof update === 'function' ? update(before) : update;
  const changes: Change[] = [];
  if (before.subscriptions !== after.subscriptions) {
    const byFeed = (items: Podcast[]) => Object.fromEntries(items.map(p => [p.feedUrl, p]));
    diffEntries('subscriptions', byFeed(before.subscriptions), byFeed(after.subscriptions), changes);
  }
  for (const field of maps) {
    if (before[field] !== after[field]) diffEntries(field, before[field] ?? {}, after[field] ?? {}, changes);
  }
  for (const field of fields) {
    // Stamp the session pointer with its checkpoint even when the episode is unchanged.
    const url = after.lastPlayingEpisode?.audioUrl;
    const checkpoint = field === 'lastPlayingEpisode' && url && after.playbackProgress[url] !== before.playbackProgress[url];
    if (field === 'lastPlayingEpisode' && after.lastPlayingEpisode && (before[field] !== after[field] || checkpoint)) {
      const episode = after.lastPlayingEpisode;
      const cached = profile.episodes?.[episode.audioUrl];
      if (cached !== episode && JSON.stringify(cached) !== JSON.stringify(episode)) {
        changes.push({ field: 'episodeMetadata', key: episode.audioUrl, value: episode });
      }
      changes.push({ field: 'sessionUrl', value: episode.audioUrl });
    } else if (before[field] !== after[field] || checkpoint
      || (field === 'queue' && profile.legacyQueue && before.lastPlayingEpisode?.id !== after.lastPlayingEpisode?.id)) {
      changes.push({ field, value: after[field] } as Change);
    }
  }
  if (changes.length) {
    const batch = { id: crypto.randomUUID(), changes, device, time: Math.max(now, profile.clock + 1) };
    applyBatch(profile, batch);
    const url = after.lastPlayingEpisode?.audioUrl;
    const progress = changes.find(change => change.field === 'playbackProgress');
    const checkpoint = progress?.value && progress.key === url ? url : undefined;
    const routineOnly = routine && !urgent && checkpoint && changes.every(change =>
      change.field === 'playbackProgress' && change.key === checkpoint
      || change.field === 'episodeMetadata' || change.field === 'sessionUrl');
    if (checkpoint && (routineOnly || urgent)) {
      const previous = profile.pending.find(entry => entry.checkpoint === checkpoint && entry.due !== undefined && !entry.fileId);
      if (previous) {
        const metadata = previous.batch.changes.find(change => change.field === 'episodeMetadata');
        if (metadata && !changes.some(change => change.field === 'episodeMetadata')) changes.unshift(metadata);
        profile.pending = profile.pending.filter(entry => entry !== previous);
      }
      const lastUpload = profile.lastCheckpointUpload?.[checkpoint] ?? now;
      const due = routineOnly ? previous?.due ?? Math.max(now, lastUpload + routineUploadInterval) : undefined;
      profile.pending.push({ batch, urgent, checkpoint, due });
    } else {
      profile.pending.push({ batch, urgent });
    }
  }
}

export function coalescePlaybackCheckpoints(profile: Profile) {
  const latest = new Map<string, Profile['pending'][number]>();
  // Each newer checkpoint for an episode replaces both fields of its older checkpoints.
  profile.pending = profile.pending.slice().reverse().filter(entry => {
    if (entry.fileId) return true;
    const { changes } = entry.batch;
    if (changes.length !== 2) return true;
    const progress = changes.find(change => change.field === 'playbackProgress');
    const session = changes.find(change => change.field === 'lastPlayingEpisode');
    if (!progress?.value || session?.value?.audioUrl !== progress.key) return true;

    const newer = latest.get(progress.key);
    if (newer) {
      newer.urgent ||= entry.urgent;
      return false;
    }
    latest.set(progress.key, entry);
    return true;
  }).reverse();
}

export function applyBatch(profile: Profile, batch: Batch) {
  if (Object.hasOwn(profile.applied, batch.id)) return;
  const { time, device } = batch;
  const copied = new Set<MapField>();
  for (const change of batch.changes) {
    const field = change.field === 'sessionUrl' ? 'lastPlayingEpisode' : change.field;
    if (change.field === 'lastPlayingEpisode' && change.value) {
      applyEpisodeMetadata(profile, change.value, time, device);
    }
    const path = JSON.stringify([field, change.key]);
    const previous = profile.versions[path];
    if (previous && (previous.time > time || (previous.time === time && previous.device >= device))) continue;
    profile.versions[path] = { time, device };
    const { state } = profile;
    if (change.field === 'episodeMetadata') {
      (profile.episodes ??= {})[change.key] = change.value;
    } else if (change.field === 'sessionUrl') {
      profile.sessionUrl = change.value;
    } else if (change.field === 'lastPlayingEpisode') {
      profile.sessionUrl = change.value?.audioUrl;
      state.lastPlayingEpisode = change.value;
    } else if (change.field === 'queue') {
      profile.legacyQueue = Array.isArray(change.value) ? change.value : undefined;
      state.queue = normalizeQueue(change.value);
    } else if (change.field === 'subscriptions') {
      const items = state.subscriptions.filter(p => p.feedUrl !== change.key);
      if (change.value) items.push(change.value);
      state.subscriptions = items.sort((a, b) => a.feedUrl.localeCompare(b.feedUrl, 'en'));
    } else if (change.key !== undefined) {
      if (!copied.has(change.field)) {
        Object.assign(state, { [change.field]: { ...state[change.field] } });
        copied.add(change.field);
      }
      const entries = state[change.field] as Record<string, unknown>;
      if (change.value === undefined) delete entries[change.key];
      else Object.defineProperty(entries, change.key, { value: change.value, enumerable: true, configurable: true, writable: true });
    } else {
      Object.assign(state, { [change.field]: change.value });
    }
  }
  if (profile.sessionUrl) {
    const url = profile.sessionUrl;
    const episode = profile.episodes?.[url]
      ?? (profile.legacyQueue ?? orderedQueue(profile.state.queue)).find(item => item.audioUrl === url)
      ?? profile.state.newReleases.find(item => item.audioUrl === url);
    profile.state.lastPlayingEpisode = episode ?? (profile.state.lastPlayingEpisode?.audioUrl === url
      ? profile.state.lastPlayingEpisode : null);
  }
  if (profile.legacyQueue) {
    // A legacy queue can arrive before the session batch that identifies its current episode.
    const current = profile.state.lastPlayingEpisode;
    const waiting = profile.legacyQueue.filter(item => item.id !== current?.id);
    const previous = profile.state.queue.secondary;
    if (waiting.length !== previous.length || waiting.some((item, index) => item !== previous[index])) {
      profile.state.queue = { primary: [], secondary: waiting };
    }
  }
  profile.clock = Math.max(profile.clock, time);
  profile.applied[batch.id] = true;
}

function applyEpisodeMetadata(profile: Profile, episode: Episode, time: number, device: string) {
  const path = JSON.stringify(['episodeMetadata', episode.audioUrl]);
  const previous = profile.versions[path];
  if (previous && (previous.time > time || (previous.time === time && previous.device >= device))) return;
  profile.versions[path] = { time, device };
  (profile.episodes ??= {})[episode.audioUrl] = episode;
}

// Edits saved by older versions can precede the initial snapshot download.
export function seedProfile(profile: Profile, snapshot: StateSnapshot) {
  if (profile.seeded) return profile;
  const seeded = { ...profile, ...newProfile(snapshot), episodes: undefined, sessionUrl: undefined,
    legacyQueue: undefined, pending: profile.pending };
  for (const { batch } of seeded.pending) applyBatch(seeded, batch);
  return seeded;
}
