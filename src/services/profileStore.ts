import { newProfile } from './profileChanges.ts';
import type { Profile } from './profileChanges.ts';
import { normalizeState } from './playbackQueue.ts';

let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('PodcastDriveProfiles', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('profiles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
  return database;
}

// The transaction covers the snapshot, item clocks and outbox together, including across tabs.
export async function accessProfile(id: string, edit?: (profile: Profile) => Profile | void): Promise<Profile> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('profiles', edit ? 'readwrite' : 'readonly');
    const store = tx.objectStore('profiles');
    const request = store.get(id);
    let profile: Profile;
    request.onsuccess = () => {
      profile = request.result ?? newProfile();
      if (request.result) profile.state = normalizeState(profile.state);
      if (edit) {
        try {
          profile = edit(profile) ?? profile;
          store.put(profile, id);
        } catch (error) {
          tx.abort();
          reject(error);
        }
      }
    };
    tx.oncomplete = () => resolve(profile);
    tx.onabort = () => reject(tx.error ?? new Error('Profile transaction aborted'));
  });
}
