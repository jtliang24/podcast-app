import { useState, useCallback, useEffect, useRef } from 'react';
import type { AppState } from '../types';
import { INITIAL_STATE } from '../types';
import { DriveSync } from '../services/driveSync';
import type { ResumePoint, SyncStatus } from '../services/driveSync';
import { accessProfile } from '../services/profileStore';
import { seedProfile } from '../services/profileChanges';
import type { StateUpdate } from '../services/profileChanges';

type StorageMode = 'file-system-access' | 'opfs' | 'google-drive';

const DB_NAME = 'PodcastFileDB';
const STORE_NAME = 'handles';

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveHandleToIDB(handle: FileSystemFileHandle) {
  const db = await getDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(handle, 'stateFileHandle');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getHandleFromIDB(): Promise<FileSystemFileHandle | undefined> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get('stateFileHandle');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const saveToOPFS = async (newState: AppState) => {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle('podcast_state.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(newState, null, 2));
    await writable.close();
  } catch (err) {
    console.error('Error saving to OPFS:', err);
  }
};

const saveState = async (handle: FileSystemFileHandle, newState: AppState) => {
  try {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(newState, null, 2));
    await writable.close();
  } catch (err) {
    console.error('Error saving state:', err);
  }
};

export function useFileSystem() {
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [storageMode, setStorageMode] = useState<StorageMode | null>(() => localStorage.getItem('storageMode') as StorageMode | null);
  const [driveFileId, setDriveFileId] = useState(() => localStorage.getItem('driveFileId'));
  const [driveToken, setDriveToken] = useState(() => localStorage.getItem('driveAccessToken'));
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('Saved on this device');
  const [remoteSession, setRemoteSession] = useState<ResumePoint | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const sync = useRef<DriveSync | null>(null);

  // Keep state in a ref to always have the latest version for functional updates and I/O
  const stateRef = useRef<AppState>(state);
  const publish = useCallback((next: AppState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Persist storage settings to localStorage
  useEffect(() => {
    if (storageMode) localStorage.setItem('storageMode', storageMode);
  }, [storageMode]);

  const connectDrive = async (token: string, id: string, initial?: AppState) => {
    if (storageMode === 'google-drive' && driveFileId && id !== driveFileId) {
      throw new Error('Reconnect with the Google account that owns this library.');
    }
    if (initial) await accessProfile(id, profile => seedProfile(profile, initial));
    if (storageMode !== 'google-drive') setIsLoading(true);
    localStorage.setItem('driveFileId', id);
    localStorage.setItem('driveAccessToken', token);
    localStorage.setItem('storageMode', 'google-drive');
    setDriveFileId(id);
    setDriveToken(token);
    setStorageMode('google-drive');
    if (driveToken === token) sync.current?.refresh();
  };

  const refreshDrive = useCallback(() => sync.current?.refresh(), []);
  useEffect(() => {
    if (storageMode !== 'google-drive' || !driveFileId) return;
    let device = localStorage.getItem('driveDeviceId');
    if (!device) {
      device = crypto.randomUUID();
      localStorage.setItem('driveDeviceId', device);
    }
    const engine = new DriveSync(driveFileId, driveToken, device, {
      state: publish, remote: setRemoteSession, status: setSyncStatus,
      expired: () => { localStorage.removeItem('driveAccessToken'); setDriveToken(null); },
    });
    sync.current = engine;
    engine.restore().catch(() => setStorageError('Could not open the saved Drive library on this device.'))
      .finally(() => { if (sync.current === engine) setIsLoading(false); });
    const refresh = () => engine.refresh();
    const foreground = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      engine.stop();
      sync.current = null;
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [storageMode, driveFileId, driveToken, publish]);

  // Check support on mount
  const isFileSystemAccessSupported = 'showOpenFilePicker' in window;

  const loadFromOPFS = useCallback(async () => {
    setIsLoading(true);
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle('podcast_state.json', { create: true });
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (text) {
        const parsed = JSON.parse(text) as Partial<AppState>;
        const newState = { ...INITIAL_STATE, ...parsed };
        publish(newState);
      } else {
        // New file, save initial state
        await saveToOPFS(INITIAL_STATE);
      }
    } catch (err) {
      console.error('Error loading from OPFS:', err);
      publish(INITIAL_STATE);
    } finally {
      setIsLoading(false);
    }
  }, [publish]);

  const loadState = useCallback(async (handle: FileSystemFileHandle) => {
    setIsLoading(true);
    try {
      const file = await handle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<AppState>;
      publish({ ...INITIAL_STATE, ...parsed });
    } catch (err) {
      console.error('Error loading state:', err);
      publish(INITIAL_STATE);
    } finally {
      setIsLoading(false);
    }
  }, [publish]);

  // Initialize storage or try to load saved state
  useEffect(() => {
    const init = async () => {
      if (localStorage.getItem('storageMode') === 'google-drive' && localStorage.getItem('driveFileId')) return;

      if (!isFileSystemAccessSupported) {
        setStorageMode('opfs');
        await loadFromOPFS();
      } else {
        // Try to load saved handle from IndexedDB
        try {
          const handle = await getHandleFromIDB();
          if (handle) {
            // Verify we still have permission (might prompt user)
            const options: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
            let permission = await handle.queryPermission(options);
            
            if (permission !== 'granted') {
              permission = await handle.requestPermission(options);
            }

            if (permission === 'granted') {
              setFileHandle(handle);
              setStorageMode('file-system-access');
              await loadState(handle);
            }
          }
        } catch (e) {
          console.error('Error verifying saved file handle:', e);
        } finally {
          setIsLoading(false);
        }
      }
    };

    init();
  }, [isFileSystemAccessSupported, loadFromOPFS, loadState]);

  const selectFile = useCallback(async () => {
    if (!isFileSystemAccessSupported) return;
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'JSON Files',
            accept: { 'application/json': ['.json'] },
          },
        ],
        multiple: false,
      });
      setFileHandle(handle);
      setStorageMode('file-system-access');
      await saveHandleToIDB(handle);
      await loadState(handle);
    } catch (err) {
      console.error('Error selecting file:', err);
    }
  }, [isFileSystemAccessSupported, loadState]);

  const createNewFile = useCallback(async () => {
    if (!isFileSystemAccessSupported) return;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'podcast_state.json',
        types: [
          {
            description: 'JSON Files',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      setFileHandle(handle);
      setStorageMode('file-system-access');
      await saveHandleToIDB(handle);
      await saveState(handle, INITIAL_STATE);
      publish(INITIAL_STATE);
    } catch (err) {
      console.error('Error creating file:', err);
    }
  }, [isFileSystemAccessSupported, publish]);

  const writes = useRef(Promise.resolve());
  const updateState = useCallback(async (update: StateUpdate, urgent = false) => {
    if (storageMode === 'google-drive') {
      if (!sync.current) return;
      try {
        await sync.current.edit(update, urgent);
        setStorageError(null);
      } catch (error) {
        setStorageError('Could not save this change on this device.');
        console.error(error);
      }
      return;
    }
    const next = typeof update === 'function' ? update(stateRef.current) : update;
    // Immediate state update for UI responsiveness
    publish(next);
    // Persist to disk in action order.
    writes.current = writes.current.then(async () => {
      if (storageMode === 'file-system-access' && fileHandle) await saveState(fileHandle, next);
      else if (storageMode === 'opfs') await saveToOPFS(next);
    });
    await writes.current;
  }, [fileHandle, storageMode, publish]);

  const exportState = useCallback(async () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'podcast_state.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [state]);

  const importState = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as AppState;
      await updateState({ ...INITIAL_STATE, ...parsed });
    } catch (err) {
      console.error('Error importing state:', err);
    }
  }, [updateState]);

  return {
    state,
    fileHandle,
    isLoading,
    storageMode,
    isFileSystemAccessSupported,
    selectFile,
    createNewFile,
    updateState,
    exportState,
    importState,
    connectDrive,
    driveFileId,
    syncStatus,
    refreshDrive,
    remoteSession,
    storageError
  };
}
