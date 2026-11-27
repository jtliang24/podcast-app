import type { Episode } from '../types.ts';
import { resolveExtras } from './episodeExtras.ts';
import { fetchRemoteText } from './podcastService.ts';
import { isPrivateSubstackFeed } from './substackFeed.ts';
import { pickTranscript, transcriptFormat } from './transcripts.ts';

/*
 * Per-device cache of chapter and transcript files. It lives in its own IndexedDB database, never in
 * `AppState`, so the files don't sync. Files for downloaded episodes are pinned so they work offline; other
 * files are evicted least recently used first. Every exported function is best effort and never rejects.
 */

const DB_NAME = 'podcast_episode_extras';
const DB_VERSION = 1;
/** Cached files (`ExtraFile`), keyed by URL. */
const FILES_STORE = 'files';
/** The URLs each downloaded episode pinned (`PinRecord`), keyed by episode id, so removal can unpin them. */
const PINS_STORE = 'pins';

/** Unpinned files kept beyond this count are evicted. Pinned files are bounded by the downloads. */
export const MAX_UNPINNED_FILES = 100;
/** The declared type of `podcast:chapters` files. */
export const CHAPTERS_TYPE = 'application/json+chapters';

export interface ExtraFile {
  body: string;
  /** The media type the feed declared. */
  type: string;
  fetchedAt: number;
  pinned: boolean;
  lastUsed?: number;
}

export interface ExtraEntry {
  url: string;
  pinned: boolean;
  fetchedAt: number;
  lastUsed?: number;
}

interface PinRecord {
  id: string;
  urls: string[];
}

export interface ExtraLoadOptions {
  /** The declared media type, stored with the file and used to choose the Accept header. */
  type: string;
  /** Limits the request to a direct fetch: no public proxies. */
  privateSource?: boolean;
  accept?: string;
  /** Keeps the file until `unpinExtras`; an already pinned file stays pinned either way. */
  pinned?: boolean;
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

/** The URLs to evict: unpinned entries beyond `limit`, least recently used first. Pinned entries stay. */
export function selectEvictions(entries: readonly ExtraEntry[], limit = MAX_UNPINNED_FILES): string[] {
  return entries
    .filter(entry => !entry.pinned)
    .sort((a, b) => recency(b) - recency(a) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
    .slice(limit)
    .map(entry => entry.url);
}

/** The URLs a removed pin releases: those no remaining pin still holds. */
export function urlsToRelease(urls: readonly string[], remaining: readonly { urls: readonly string[] }[]): string[] {
  const held = new Set(remaining.flatMap(pin => pin.urls));
  return [...new Set(urls)].filter(url => !held.has(url));
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
      if (!db.objectStoreNames.contains(FILES_STORE)) db.createObjectStore(FILES_STORE);
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

/** Queues eviction of unpinned files beyond the limit. Only metadata is collected, one record at a time. */
function evict(files: IDBObjectStore): void {
  const count = files.count();
  count.onsuccess = () => {
    if (count.result <= MAX_UNPINNED_FILES) return;
    const entries: ExtraEntry[] = [];
    const cursor = files.openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (current) {
        const { pinned, fetchedAt, lastUsed } = current.value as ExtraFile;
        entries.push({ url: String(current.key), pinned, fetchedAt, lastUsed });
        current.continue();
      } else {
        for (const url of selectEvictions(entries)) files.delete(url);
      }
    };
  };
}

/** Returns the cached file and records the use, pinning it when asked. */
function touchFile(url: string, pinned: boolean): Promise<ExtraFile | undefined> {
  return transact<ExtraFile>([FILES_STORE], 'readwrite', (transaction, result) => {
    const files = transaction.objectStore(FILES_STORE);
    const request = files.get(url);
    request.onsuccess = () => {
      const file = request.result as ExtraFile | undefined;
      if (!file) return;
      result.value = { ...file, pinned: file.pinned || pinned, lastUsed: Date.now() };
      files.put(result.value, url);
    };
  });
}

async function storeFile(url: string, file: ExtraFile): Promise<void> {
  await transact([FILES_STORE], 'readwrite', transaction => {
    const files = transaction.objectStore(FILES_STORE);
    const request = files.get(url);
    request.onsuccess = () => {
      const existing = request.result as ExtraFile | undefined;
      files.put({ ...file, pinned: file.pinned || !!existing?.pinned }, url);
      evict(files);
    };
  });
}

async function savePin(pin: PinRecord): Promise<void> {
  await transact([PINS_STORE], 'readwrite', transaction => {
    transaction.objectStore(PINS_STORE).put(pin);
  });
}

async function removePin(episodeId: string): Promise<void> {
  await transact([FILES_STORE, PINS_STORE], 'readwrite', transaction => {
    const files = transaction.objectStore(FILES_STORE);
    const pins = transaction.objectStore(PINS_STORE);
    const request = pins.get(episodeId);
    request.onsuccess = () => {
      const pin = request.result as PinRecord | undefined;
      if (!pin) return;
      pins.delete(episodeId);
      const remaining = pins.getAll();
      remaining.onsuccess = () => {
        for (const url of urlsToRelease(pin.urls, remaining.result as PinRecord[])) {
          const file = files.get(url);
          file.onsuccess = () => {
            if (file.result) files.put({ ...(file.result as ExtraFile), pinned: false }, url);
          };
        }
        evict(files);
      };
    };
  });
}

// Public API

/**
 * Loads a chapter or transcript file: the cached copy if there is one (recording the use), otherwise a
 * fetch through `fetchRemoteText`, which is then cached. Resolves to `null` when the file can't be loaded.
 */
export async function loadExtraFile(
  url: string,
  { type, privateSource = false, accept = acceptFor(type), pinned = false }: ExtraLoadOptions,
): Promise<string | null> {
  try {
    const cached = await touchFile(url, pinned);
    if (cached) return cached.body;
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
    await storeFile(url, { body, type, fetchedAt: now, lastUsed: now, pinned });
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
 * Caches and pins a downloaded episode's chapters and preferred transcript so they work offline. Older
 * episode copies get their extras through `resolveExtras`.
 */
export function pinExtras(episode: Episode): Promise<void> {
  return serialize(episode.id, async () => {
    const resolved = await resolveExtras(episode);
    const language = typeof navigator === 'undefined' ? undefined : navigator.language;
    const wanted = preferredExtras(resolved, language);
    if (!wanted.length) return;
    const privateSource = isPrivateExtraSource(episode.podcastId);
    const loaded = await Promise.all(wanted.map(({ url, type }) => loadExtraFile(url, { type, privateSource, pinned: true })));
    const urls = wanted.filter((_, index) => loaded[index] !== null).map(file => file.url);
    if (urls.length) await savePin({ id: episode.id, urls });
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
