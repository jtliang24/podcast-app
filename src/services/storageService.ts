import type { Episode } from '../types';
import { AndroidDownloads, isAndroid } from './android';

const DB_NAME = 'podcast_downloads';
const DB_VERSION = 1;
const STORE_NAME = 'downloads';

function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

export async function downloadEpisode(episode: Episode): Promise<void> {
  if (isAndroid) return AndroidDownloads.download({ episode });
  const response = await fetch(episode.audioUrl);
  if (!response.ok) throw new Error('Episode download failed');
  await saveDownload(episode, await response.blob());
}

async function saveDownload(episode: Episode, audioBlob: Blob): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const record = {
      id: episode.id,
      episode: episode,
      audioBlob: audioBlob,
    };

    store.put(record);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function getAllDownloadedEpisodes(): Promise<Episode[]> {
  if (isAndroid) return (await AndroidDownloads.list()).episodes;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = (event) => {
      const records = (event.target as IDBRequest).result || [];
      // Extract just the metadata
      resolve(records.map((r: { episode: Episode }) => r.episode));
    };
    request.onerror = (event) => reject((event.target as IDBRequest).error);
  });
}

export async function getAudioBlob(episodeId: string): Promise<Blob | null> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(episodeId);

    request.onsuccess = (event) => {
      const record = (event.target as IDBRequest).result;
      resolve(record ? record.audioBlob : null);
    };
    request.onerror = (event) => reject((event.target as IDBRequest).error);
  });
}

export async function deleteDownload(episodeId: string): Promise<void> {
  if (isAndroid) return AndroidDownloads.remove({ id: episodeId });
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete(episodeId);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}
