import type { Episode } from '../types.ts';
import { lookupExtras, type EpisodeExtras } from './episodeExtras.ts';
import { fetchRemoteText } from './podcastService.ts';
import { isPrivateSubstackFeed } from './substackFeed.ts';
import { pickTranscript, transcriptFormat } from './transcripts.ts';

/*
 * Per-device cache of chapter and transcript files. It lives in its own IndexedDB database, never in
 * `AppState`, so the files don't sync. Files for downloaded episodes are pinned so they work offline; other
 * files are evicted least recently used first. Every exported function is best effort and never rejects.
 *
 * A file is pinned exactly while some pin record lists its URL. There is no separate flag to set or clear,
 * so a crash can't leave a file pinned forever, and a URL shared by several downloads stays pinned until the
 * last of them is removed.
 */

const DB_NAME = 'podcast_episode_extras';
const DB_VERSION = 2;
/** Cached file metadata (`ExtraEntry`), keyed by URL, so eviction and recording a use never touch bodies. */
const ENTRIES_STORE = 'entries';
/** Cached file bodies (strings), keyed by URL. Each has an entry with the same URL. */
const BODIES_STORE = 'bodies';
/** Version 1 kept each body and its metadata together in this store. Upgrading drops it. */
const LEGACY_FILES_STORE = 'files';
/**
 * The URLs each downloaded episode pinned (`PinRecord`), keyed by episode id, so removal can unpin them. It
 * also keeps the extras of older episode copies, so they work offline without the feed.
 */
const PINS_STORE = 'pins';

/** Unpinned files kept beyond this count are evicted. Pinned files are bounded by the downloads. */
export const MAX_UNPINNED_FILES = 100;
/** The declared type of `podcast:chapters` files. */
export const CHAPTERS_TYPE = 'application/json+chapters';

export interface ExtraEntry {
  url: string;
  /** The media type the feed declared. */
  type: string;
  fetchedAt: number;
  lastUsed?: number;
}

export interface PinRecord {
  id: string;
  urls: string[];
  /** The extras `resolveExtras` found for an episode copy that lacks them. */
  extras?: EpisodeExtras;
}

export interface ExtraLoadOptions {
  /** The declared media type, stored with the file and used to choose the Accept header. */
  type: string;
  /** Limits the request to a direct fetch: no public proxies. */
  privateSource?: boolean;
  accept?: string;
}

// Pure helpers

/** Extras of a private Substack feed follow the feed's rule and never go through public proxies. */
export function isPrivateExtraSource(feedUrl: string): boolean {
  try {
    return isPrivateSubstackFeed(new URL(feedUrl));
  } catch {
    return false;
  }
}

const SRT_ACCEPT = 'application/x-subrip, application/srt';
const ACCEPT = new Map([
  [CHAPTERS_TYPE, 'application/json'],
  ['application/json', 'application/json'],
  ['text/vtt', 'text/vtt'],
  ['application/x-subrip', SRT_ACCEPT],
  ['application/srt', SRT_ACCEPT],
  ['text/html', 'text/html'],
  ['text/plain', 'text/plain'],
]);

/**
 * The Accept header for a declared type, using only the media types Android's native HTTP allows (so
 * chapters ask for `application/json`). Unknown types get `undefined`, which means the default.
 */
export function acceptFor(type: string): string | undefined {
  return ACCEPT.get(transcriptFormat(type));
}

const recency = (entry: ExtraEntry) => entry.lastUsed ?? entry.fetchedAt;

/** The URLs some pin record lists, which are exactly the pinned files. */
export function pinnedUrls(pins: readonly Pick<PinRecord, 'urls'>[]): Set<string> {
  return new Set(pins.flatMap(pin => pin.urls));
}

/**
 * The URLs to evict: unpinned entries beyond `limit`, least recently used first. Entries a pin in `pins`
 * lists stay.
 */
export function selectEvictions(
  entries: readonly ExtraEntry[],
  pins: readonly Pick<PinRecord, 'urls'>[],
  limit = MAX_UNPINNED_FILES,
): string[] {
  const pinned = pinnedUrls(pins);
  return entries
    .filter(entry => !pinned.has(entry.url))
    .sort((a, b) => recency(b) - recency(a) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
    .slice(limit)
    .map(entry => entry.url);
}

/** The files to keep offline for a downloaded episode: its chapters and its preferred transcript. */
export function preferredExtras(episode: Episode, language?: string): { url: string; type: string }[] {
  const files: { url: string; type: string }[] = [];
  if (episode.chaptersUrl) files.push({ url: episode.chaptersUrl, type: CHAPTERS_TYPE });
  const transcript = pickTranscript(episode.transcripts, language);
  if (transcript) files.push({ url: transcript.url, type: transcript.type });
  return files;
}

// IndexedDB

function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      // Version 1 files are dropped rather than split: it's a cache, and a later load fetches them again. Its
      // pin records keep the same shape, so a file they list is pinned again once it's cached.
      if (db.objectStoreNames.contains(LEGACY_FILES_STORE)) db.deleteObjectStore(LEGACY_FILES_STORE);
      if (!db.objectStoreNames.contains(ENTRIES_STORE)) db.createObjectStore(ENTRIES_STORE, { keyPath: 'url' });
      if (!db.objectStoreNames.contains(BODIES_STORE)) db.createObjectStore(BODIES_STORE);
      if (!db.objectStoreNames.contains(PINS_STORE)) db.createObjectStore(PINS_STORE, { keyPath: 'id' });
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

/** Runs `run` in one transaction and resolves with whatever it put in `result` once the transaction commits. */
async function transact<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction, result: { value?: T }) => void,
): Promise<T | undefined> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    const result: { value?: T } = {};
    transaction.oncomplete = () => {
      db.close();
      resolve(result.value);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error);
    };
    run(transaction, result);
  });
}

/** The stores a write that may evict needs. */
const EVICTING_STORES = [ENTRIES_STORE, BODIES_STORE, PINS_STORE];

/**
 * Queues eviction of unpinned files beyond the limit, in a transaction over `EVICTING_STORES`. Only the
 * entries and pin records are read; bodies are only deleted.
 */
function evict(transaction: IDBTransaction): void {
  const entries = transaction.objectStore(ENTRIES_STORE);
  const count = entries.count();
  count.onsuccess = () => {
    // Pinned files are counted too, so this only skips the work when there can't be too many unpinned ones.
    if (count.result <= MAX_UNPINNED_FILES) return;
    const pins = transaction.objectStore(PINS_STORE).getAll();
    const all = entries.getAll();
    // Requests complete in order, so the pins were read before the entries.
    all.onsuccess = () => {
      const bodies = transaction.objectStore(BODIES_STORE);
      for (const url of selectEvictions(all.result as ExtraEntry[], pins.result as PinRecord[])) {
        entries.delete(url);
        bodies.delete(url);
      }
    };
  };
}

/** Returns the cached body and records the use, which rewrites only the file's entry. */
function readFile(url: string): Promise<string | undefined> {
  return transact<string>([ENTRIES_STORE, BODIES_STORE], 'readwrite', (transaction, result) => {
    const entries = transaction.objectStore(ENTRIES_STORE);
    const entry = entries.get(url);
    const body = transaction.objectStore(BODIES_STORE).get(url);
    body.onsuccess = () => {
      const found = entry.result as ExtraEntry | undefined;
      if (!found || typeof body.result !== 'string') return;
      result.value = body.result;
      entries.put({ ...found, lastUsed: Date.now() });
    };
  });
}

async function storeFile(entry: ExtraEntry, body: string): Promise<void> {
  await transact(EVICTING_STORES, 'readwrite', transaction => {
    transaction.objectStore(ENTRIES_STORE).put(entry);
    transaction.objectStore(BODIES_STORE).put(body, entry.url);
    evict(transaction);
  });
}

async function savePin(pin: PinRecord): Promise<void> {
  await transact([PINS_STORE], 'readwrite', transaction => {
    transaction.objectStore(PINS_STORE).put(pin);
  });
}

async function readPin(episodeId: string): Promise<PinRecord | undefined> {
  return transact<PinRecord>([PINS_STORE], 'readonly', (transaction, result) => {
    const request = transaction.objectStore(PINS_STORE).get(episodeId);
    request.onsuccess = () => { result.value = request.result as PinRecord | undefined; };
  });
}

/** Deletes the pin record, which unpins every URL no other record lists, and evicts beyond the limit. */
async function removePin(episodeId: string): Promise<void> {
  await transact(EVICTING_STORES, 'readwrite', transaction => {
    transaction.objectStore(PINS_STORE).delete(episodeId);
    evict(transaction);
  });
}

// Public API

/**
 * Loads a chapter or transcript file: the cached copy if there is one (recording the use), otherwise a
 * fetch through `fetchRemoteText`, which is then cached. Resolves to `null` when the file can't be loaded.
 */
export async function loadExtraFile(
  url: string,
  { type, privateSource = false, accept = acceptFor(type) }: ExtraLoadOptions,
): Promise<string | null> {
  try {
    const cached = await readFile(url);
    if (cached !== undefined) return cached;
  } catch (error) {
    console.warn('Could not read cached episode extras.', error);
  }

  let body: string;
  try {
    body = await fetchRemoteText(url, { privateSource, accept });
  } catch {
    return null;
  }

  const now = Date.now();
  try {
    await storeFile({ url, type, fetchedAt: now, lastUsed: now }, body);
  } catch (error) {
    console.warn('Could not cache episode extras.', error);
  }
  return body;
}

/**
 * Loads one of `episode`'s extras through the cache, applying the private feed rule. For chapters pass
 * `{ url: episode.chaptersUrl, type: CHAPTERS_TYPE }`; a `TranscriptRef` can be passed as is.
 */
export function loadEpisodeExtra(
  episode: Pick<Episode, 'podcastId'>,
  file: { url: string; type: string },
): Promise<string | null> {
  return loadExtraFile(file.url, { type: file.type, privateSource: isPrivateExtraSource(episode.podcastId) });
}

const queues = new Map<string, Promise<void>>();

/** Runs pin work for one episode in call order, so removing a download right away can't race its pin. */
function serialize(episodeId: string, work: () => Promise<void>): Promise<void> {
  const task: Promise<void> = (queues.get(episodeId) ?? Promise.resolve())
    .then(work)
    .catch(error => { console.warn('Could not update offline episode extras.', error); })
    .finally(() => {
      if (queues.get(episodeId) === task) queues.delete(episodeId);
    });
  queues.set(episodeId, task);
  return task;
}

/**
 * The extras this device kept for a downloaded episode copy that lacks them, read by `resolveExtras` before
 * it fetches the feed. Resolves to `undefined` when there are none or the cache is unavailable.
 */
export async function storedExtras(episodeId: string): Promise<EpisodeExtras | undefined> {
  try {
    return (await readPin(episodeId))?.extras;
  } catch {
    return undefined;
  }
}

/**
 * Caches and pins a downloaded episode's chapters and preferred transcript so they work offline. Older
 * episode copies get their extras through `lookupExtras`, and those are kept with the pin so the episode
 * finds its files offline too.
 *
 * The pin record is written before the files are fetched, so they are pinned as soon as they are cached. A
 * file that can't be fetched now stays listed and is pinned when a later load caches it.
 */
export function pinExtras(episode: Episode): Promise<void> {
  return serialize(episode.id, async () => {
    const extras = episode.transcripts === undefined ? await lookupExtras(episode) : undefined;
    const resolved = extras ? { ...episode, ...extras } : episode;
    const language = typeof navigator === 'undefined' ? undefined : navigator.language;
    const wanted = preferredExtras(resolved, language);
    if (!wanted.length && !extras) return;
    await savePin({ id: episode.id, urls: wanted.map(file => file.url), extras });
    const privateSource = isPrivateExtraSource(episode.podcastId);
    await Promise.all(wanted.map(({ url, type }) => loadExtraFile(url, { type, privateSource })));
  });
}

/** Unpins what `pinExtras` kept for a removed download, leaving the files to normal eviction. */
export function unpinExtras(episodeId: string): Promise<void> {
  return serialize(episodeId, () => removePin(episodeId));
}

/** Unpins extras of every episode that is no longer downloaded, e.g. one cleaned up while the app was closed. */
export async function unpinExtrasExcept(downloadedIds: Iterable<string>): Promise<void> {
  try {
    const keep = new Set(downloadedIds);
    const ids = await transact<IDBValidKey[]>([PINS_STORE], 'readonly', (transaction, result) => {
      const request = transaction.objectStore(PINS_STORE).getAllKeys();
      request.onsuccess = () => { result.value = request.result; };
    });
    await Promise.all((ids ?? []).filter((id): id is string => typeof id === 'string' && !keep.has(id) && !queues.has(id))
      .map(id => unpinExtras(id)));
  } catch (error) {
    console.warn('Could not release offline episode extras.', error);
  }
}
