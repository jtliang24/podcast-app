import { useState, useCallback, useEffect, useRef } from 'react';
import type { AppState } from '../types';
import { INITIAL_STATE } from '../types';

type StorageMode = 'file-system-access' | 'opfs';

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

export function useFileSystem() {
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [isLoading, setIsLoading] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode | null>(null);

  // Keep state in a ref to always have the latest version for functional updates and I/O
  const stateRef = useRef<AppState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Check support on mount
  const isFileSystemAccessSupported = 'showOpenFilePicker' in window;

  // Initialize OPFS or try to load saved handle
  useEffect(() => {
    if (!isFileSystemAccessSupported) {
      setStorageMode('opfs');
      loadFromOPFS();
    } else {
      // Try to load saved handle from IndexedDB
      getHandleFromIDB()
        .then(async handle => {
          if (handle) {
            try {
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
              } else {
                console.warn('Permission to access saved file was denied.');
              }
            } catch (e) {
              console.error('Error verifying saved file handle:', e);
            }
          }
        })
        .catch(console.error);
    }
  }, [isFileSystemAccessSupported]);

  const loadFromOPFS = async () => {
    setIsLoading(true);
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle('podcast_state.json', { create: true });
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (text) {
        const parsed = JSON.parse(text) as Partial<AppState>;
        const newState = { ...INITIAL_STATE, ...parsed };
        setState(newState);
      } else {
        // New file, save initial state
        await saveToOPFS(INITIAL_STATE);
      }
    } catch (err) {
      console.error('Error loading from OPFS:', err);
      setState(INITIAL_STATE);
    } finally {
      setIsLoading(false);
    }
  };

  const saveToOPFS = async (newState: AppState) => {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle('podcast_state.json', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(newState, null, 2));
      await writable.close();
      setState(newState);
    } catch (err) {
      console.error('Error saving to OPFS:', err);
    }
  };

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
  }, [isFileSystemAccessSupported]);

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
      setState(INITIAL_STATE);
    } catch (err) {
      console.error('Error creating file:', err);
    }
  }, [isFileSystemAccessSupported]);

  const loadState = async (handle: FileSystemFileHandle) => {
    setIsLoading(true);
    try {
      const file = await handle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<AppState>;
      setState({ ...INITIAL_STATE, ...parsed });
    } catch (err) {
      console.error('Error loading state:', err);
      setState(INITIAL_STATE);
    } finally {
      setIsLoading(false);
    }
  };

  const saveState = async (handle: FileSystemFileHandle, newState: AppState) => {
    try {
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(newState, null, 2));
      await writable.close();
      setState(newState);
    } catch (err) {
      console.error('Error saving state:', err);
    }
  };

  const updateState = useCallback(async (update: AppState | ((prev: AppState) => AppState)) => {
    const newState = typeof update === 'function' ? update(stateRef.current) : update;
    
    // Immediate state update for UI responsiveness
    setState(newState);
    
    // Persist to disk
    if (storageMode === 'file-system-access' && fileHandle) {
      await saveState(fileHandle, newState);
    } else if (storageMode === 'opfs') {
      await saveToOPFS(newState);
    }
  }, [fileHandle, storageMode]);

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
      await updateState(() => parsed);
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
    importState
  };
}
