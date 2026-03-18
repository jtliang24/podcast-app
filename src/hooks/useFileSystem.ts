import { useState, useCallback } from 'react';
import type { AppState } from '../types';
import { INITIAL_STATE } from '../types';

export function useFileSystem() {
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [isLoading, setIsLoading] = useState(false);

  const selectFile = useCallback(async () => {
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
      await loadState(handle);
    } catch (err) {
      console.error('Error selecting file:', err);
    }
  }, []);

  const createNewFile = useCallback(async () => {
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
      await saveState(handle, INITIAL_STATE);
      setState(INITIAL_STATE);
    } catch (err) {
      console.error('Error creating file:', err);
    }
  }, []);

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
    if (!fileHandle) return;
    await saveState(fileHandle, newState);
  }, [fileHandle]);

  return {
    state,
    fileHandle,
    isLoading,
    selectFile,
    createNewFile,
    updateState,
  };
}
