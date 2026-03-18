import type { Episode } from '../types';

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

export async function saveDownload(episode: Episode, audioBlob: Blob): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const record = {
      id: episode.id,
      episode: episode,
      audioBlob: audioBlob,
    };

    const request = store.put(record);

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject((event.target as IDBRequest).error);
  });
}

export async function getAllDownloadedEpisodes(): Promise<Episode[]> {
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
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(episodeId);

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject((event.target as IDBRequest).error);
  });
}
