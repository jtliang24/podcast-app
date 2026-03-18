import { useState, useCallback, useEffect } from 'react';
import type { AppState } from '../types';
import { INITIAL_STATE } from '../types';

type StorageMode = 'file-system-access' | 'opfs';

export function useFileSystem() {
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [isLoading, setIsLoading] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode | null>(null);

  // Check support on mount
  const isFileSystemAccessSupported = 'showOpenFilePicker' in window;

  // Initialize OPFS if needed
  useEffect(() => {
    if (!isFileSystemAccessSupported) {
      setStorageMode('opfs');
      loadFromOPFS();
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
        const parsed = JSON.parse(text) as AppState;
        setState(parsed);
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
      // @ts-ignore - createWritable might not be in all type definitions yet but is in OPFS spec
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
      const parsed = JSON.parse(text) as AppState;
      setState(parsed);
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

  const updateState = useCallback(async (newState: AppState) => {
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
      await updateState(parsed);
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
