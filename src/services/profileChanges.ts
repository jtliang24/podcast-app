import { INITIAL_STATE } from '../types.ts';
import type { AppState, Podcast } from '../types.ts';

const maps = ['playbackProgress', 'podcastSortOrders', 'playedEpisodes', 'hidePlayedEpisodes'] as const;
const fields = ['queue', 'newReleases', 'lastRefresh', 'lastPlayingEpisode'] as const;
type MapField = typeof maps[number];
type ScalarField = typeof fields[number];

type Change =
  | { field: 'subscriptions'; key: string; value?: Podcast }
  | { [K in MapField]: { field: K; key: string; value?: AppState[K][string] } }[MapField]
  | { [K in ScalarField]: { field: K; key?: never; value?: AppState[K] } }[ScalarField];

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
  pending: { batch: Batch; urgent: boolean; fileId?: string }[];
}

export function newProfile(snapshot?: Partial<AppState>): Profile {
  return { state: { ...INITIAL_STATE, ...snapshot }, seeded: !!snapshot, clock: 0, versions: {}, applied: {}, pending: [] };
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

export function recordEdit(profile: Profile, update: StateUpdate, device: string, urgent = false, now = Date.now()) {
  const before = profile.state;
  const after = typeof update === 'function' ? update(before) : update;
  const changes: Change[] = [];
  if (before.subscriptions !== after.subscriptions) {
    const byFeed = (items: Podcast[]) => Object.fromEntries(items.map(p => [p.feedUrl, p]));
    diffEntries('subscriptions', byFeed(before.subscriptions), byFeed(after.subscriptions), changes);
  }
  for (const field of maps) {
    if (before[field] !== after[field]) diffEntries(field, before[field], after[field], changes);
  }
  for (const field of fields) {
    // Stamp the session pointer with its checkpoint even when the episode is unchanged.
    const url = after.lastPlayingEpisode?.audioUrl;
    const checkpoint = field === 'lastPlayingEpisode' && url && after.playbackProgress[url] !== before.playbackProgress[url];
    if (before[field] !== after[field] || checkpoint) changes.push({ field, value: after[field] } as Change);
  }
  if (changes.length) {
    const batch = { id: crypto.randomUUID(), changes, device, time: Math.max(now, profile.clock + 1) };
    applyBatch(profile, batch);
    profile.pending.push({ batch, urgent });
  }
}

export function applyBatch(profile: Profile, batch: Batch) {
  if (Object.hasOwn(profile.applied, batch.id)) return;
  const { time, device } = batch;
  const copied = new Set<MapField>();
  for (const change of batch.changes) {
    const path = JSON.stringify([change.field, change.key]);
    const previous = profile.versions[path];
    if (previous && (previous.time > time || (previous.time === time && previous.device >= device))) continue;
    profile.versions[path] = { time, device };
    const { state } = profile;
    if (change.field === 'subscriptions') {
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
  profile.clock = Math.max(profile.clock, time);
  profile.applied[batch.id] = true;
}

// On a first offline launch, edits can precede the initial snapshot download.
export function seedProfile(profile: Profile, snapshot: Partial<AppState>) {
  if (profile.seeded) return profile;
  const seeded = newProfile(snapshot);
  seeded.pending = profile.pending;
  for (const { batch } of seeded.pending) applyBatch(seeded, batch);
  return seeded;
}
