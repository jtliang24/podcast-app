import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { searchStateFile, createStateFile } from './services/driveService';
import { useFileSystem } from './hooks/useFileSystem';
import { usePodcastPlayer } from './hooks/usePodcastPlayer';
import { fetchPodcastFeed, PrivateFeedError, searchPodcasts, parseOPML, generateOPML } from './services/podcastService';
import { saveDownload, getAllDownloadedEpisodes, deleteDownload } from './services/storageService';
import type { Podcast, Episode, SortOrder, AppState } from './types';
import { Loader2, FolderOpen, Plus, Cloud } from 'lucide-react';
import { INITIAL_STATE } from './types';

// Components
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import PodcastPlayer from './components/PodcastPlayer';
import NewReleasesView from './components/NewReleasesView';
import DownloadsView from './components/DownloadsView';
import PodcastView from './components/PodcastView';
import SearchResultsView from './components/SearchResultsView';
import EpisodeDescriptionView from './components/EpisodeDescriptionView';

export default function App() {
  const storage = useFileSystem();
  // A storage switch starts a new player. Reconnecting the same library keeps its audio element.
  return <Library key={storage.storageMode + (storage.driveFileId ?? '')} storage={storage} />;
}

function Library({ storage }: { storage: ReturnType<typeof useFileSystem> }) {
  const { 
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
    storageError,
    remoteSession,
    refreshDrive
  } = storage;

  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [driveLoadingMessage, setDriveLoadingMessage] = useState<string | null>(null);

  const loginWithGoogle = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    onSuccess: async (tokenResponse) => {
      setDriveLoadingMessage('Searching for state file...');
      try {
        const expected = storageMode === 'google-drive' ? driveFileId : null;
        const fileId = await searchStateFile(tokenResponse.access_token, expected);
        if (fileId) {
          await connectDrive(tokenResponse.access_token, fileId);
        } else if (expected) {
          alert('Reconnect with the Google account that owns this library.');
        } else {
          // File not found, enter setup phase
          setSetupToken(tokenResponse.access_token);
        }
      } catch (err) {
        console.error('Drive Error:', err);
        alert('Failed to connect to Google Drive.');
      } finally {
        setDriveLoadingMessage(null);
      }
    },
    onError: () => {
      console.error('Google Login Failed');
    },
  });

  const handleCreateDriveProfile = async () => {
    if (!setupToken) return;
    setDriveLoadingMessage('Creating new profile in Drive...');
    try {
      const fileId = await createStateFile(setupToken, JSON.stringify(INITIAL_STATE, null, 2));
      await connectDrive(setupToken, fileId, INITIAL_STATE);
      setSetupToken(null);
    } catch (err) {
      console.error('Error creating profile:', err);
      alert('Failed to create profile.');
    } finally {
      setDriveLoadingMessage(null);
    }
  };

  const handleUploadLocalStateToDrive = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && setupToken) {
      setDriveLoadingMessage('Uploading state file to Drive...');
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as AppState;
        const newState = { ...INITIAL_STATE, ...parsed };
        const fileId = await createStateFile(setupToken, JSON.stringify(newState, null, 2));
        await connectDrive(setupToken, fileId, newState);
        setSetupToken(null);
      } catch (err) {
        console.error('Error uploading to drive:', err);
        alert('Failed to upload file.');
      } finally {
        setDriveLoadingMessage(null);
      }
      e.target.value = '';
    }
  };

  const [viewMode, setViewMode] = useState<'search' | 'downloads' | 'new-releases'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [isAddingByUrl, setIsAddingByUrl] = useState(false);
  const [searchResults, setSearchResults] = useState<Podcast[]>([]);
  const [selectedPodcast, setSelectedPodcast] = useState<Podcast | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const activeFeedRef = useRef<string | null>(null);

  const switchView = useCallback((mode: 'search' | 'downloads' | 'new-releases') => {
    setViewMode(mode);
    setSelectedEpisode(null);
  }, []);
  const [allEpisodes, setAllEpisodes] = useState<Episode[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [isRefreshingNewReleases, setIsRefreshingNewReleases] = useState(false);
  
  const [downloadsReady, setDownloadsReady] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const attemptedDownloads = useRef(new Set<string>());
  const [downloadedEpisodes, setDownloadedEpisodes] = useState<Episode[]>([]);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importingStatus, setImportingStatus] = useState<string | null>(null);

  // Download Management
  const handleDownload = useCallback(async (episode: Episode) => {
    setDownloadingIds(prev => new Set(prev).add(episode.id));
    try {
      const res = await fetch(episode.audioUrl);
      if (!res.ok) throw new Error('Network response was not ok');
      const blob = await res.blob();
      await saveDownload(episode, blob);
      const newDeps = await getAllDownloadedEpisodes();
      setDownloadedEpisodes(newDeps);
    } catch (err) {
      console.error('Download failed', err);
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(episode.id);
        return next;
      });
    }
  }, []);

  const handleDeleteDownload = useCallback(async (episodeId: string) => {
    await deleteDownload(episodeId);
    const newDeps = await getAllDownloadedEpisodes();
    setDownloadedEpisodes(newDeps);
  }, []);

  // Played State Logic
  const toggleEpisodePlayed = useCallback((episodeId: string, played: boolean) => {
    updateState(prev => ({
      ...prev,
      playedEpisodes: {
        ...prev.playedEpisodes,
        [episodeId]: played
      }
    }));
  }, [updateState]);

  const toggleHidePlayed = useCallback((contextId: string, hidden: boolean) => {
    updateState(prev => ({
      ...prev,
      hidePlayedEpisodes: {
        ...prev.hidePlayedEpisodes,
        [contextId]: hidden
      }
    }));
  }, [updateState]);

  // Podcast Player Hook
  const {
    currentEpisode,
    playingPodcast,
    isPlaying,
    currentTime,
    duration,
    audioRef,
    offer,
    continueListening,
    playbackError,
    retry,
    audioEvents,
    hasRemoteOffer,
    togglePlay,
    skip,
    handleSeek,
    formatTime,
    playEpisode
  } = usePodcastPlayer({
    state,
    ready: !isLoading && !setupToken && (!isFileSystemAccessSupported || !!fileHandle || storageMode === 'google-drive'),
    updateState, downloadedEpisodes, downloadsReady, remoteSession,
  });

  // Load downloads on mount
  useEffect(() => {
    getAllDownloadedEpisodes().then(setDownloadedEpisodes).catch(console.error).finally(() => setDownloadsReady(true));
  }, []);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowRight') {
        skip(30);
      } else if (e.code === 'ArrowLeft') {
        skip(-15);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, togglePlay, skip]);

  // Search and Subscription Handlers
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setViewMode('search');
    setSelectedEpisode(null);
    if (!searchQuery) return;
    setError(null);
    const results = await searchPodcasts(searchQuery);
    setSearchResults(results);
  };

  const handleAddByUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput) return;
    setError(null);
    setIsAddingByUrl(true);
    try {
      const { podcast, episodes } = await fetchPodcastFeed(urlInput.trim());
      let alreadySubscribed = false;
      await updateState(prev => {
        if (prev.subscriptions.some(s => s.feedUrl === podcast.feedUrl)) {
          alreadySubscribed = true;
          return prev;
        }
        return { ...prev, subscriptions: [...prev.subscriptions, podcast] };
      });
      
      if (alreadySubscribed) {
        setError('Already subscribed to this podcast');
        setIsAddingByUrl(false);
        return;
      }

      setUrlInput('');
      selectPodcast(podcast, episodes);
    } catch (err) {
      console.error(err);
      setError(err instanceof PrivateFeedError ? err.message : 'Failed to fetch podcast from URL. Ensure it is a valid RSS feed.');
    } finally {
      setIsAddingByUrl(false);
    }
  };

  const handleSubscribe = async (podcast: Podcast) => {
    updateState(prev => {
      if (prev.subscriptions.some(s => s.feedUrl === podcast.feedUrl)) return prev;
      return { ...prev, subscriptions: [...prev.subscriptions, podcast] };
    });
    setSearchResults([]);
    setSearchQuery('');
    setSelectedEpisode(null);
  };

  const handleUnsubscribe = async (feedUrl: string) => {
    updateState(prev => ({ 
      ...prev, 
      subscriptions: prev.subscriptions.filter(s => s.feedUrl !== feedUrl) 
    }));
    if (selectedPodcast?.feedUrl === feedUrl) setSelectedPodcast(null);
    if (selectedEpisode?.podcastId === feedUrl) setSelectedEpisode(null);
  };

  // Sorting and Loading
  const sortEpisodes = useCallback((episodesToSort: Episode[], order: SortOrder) => {
    return [...episodesToSort].sort((a, b) => {
      switch (order) {
        case 'newest':
          return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
        case 'oldest':
          return new Date(a.pubDate).getTime() - new Date(b.pubDate).getTime();
        case 'a-z':
          return a.title.localeCompare(b.title);
        case 'z-a':
          return b.title.localeCompare(a.title);
        case 'longest':
          return b.duration - a.duration;
        case 'shortest':
          return a.duration - b.duration;
        default:
          return 0;
      }
    });
  }, []);

  const selectPodcast = async (podcast: Podcast, loadedEpisodes?: Episode[]) => {
    setViewMode('search');
    setSelectedPodcast(podcast);
    setSelectedEpisode(null);
    activeFeedRef.current = podcast.feedUrl;
    setEpisodes([]);
    setAllEpisodes([]);
    setError(null);
    setIsLoadingEpisodes(true);

    try {
      const fetchedEpisodes = loadedEpisodes ?? (await fetchPodcastFeed(podcast.feedUrl)).episodes;
      if (activeFeedRef.current !== podcast.feedUrl) return;

      const order = state.podcastSortOrders[podcast.feedUrl] || 'newest';
      const sortedEpisodes = sortEpisodes(fetchedEpisodes, order);

      setAllEpisodes(sortedEpisodes);
      setIsLoadingEpisodes(false);

      if (sortedEpisodes.length <= 100) {
        setEpisodes(sortedEpisodes);
      } else {
        const initialChunk = sortedEpisodes.slice(0, 20);
        setEpisodes(initialChunk);

        let currentIndex = 20;
        const chunkSize = 50;
        const autoLimit = 120;

        const loadNextAutoChunk = () => {
          if (activeFeedRef.current !== podcast.feedUrl) return;
          if (currentIndex >= autoLimit || currentIndex >= sortedEpisodes.length) return;

          const nextIndex = Math.min(currentIndex + chunkSize, autoLimit, sortedEpisodes.length);
          const nextChunk = sortedEpisodes.slice(currentIndex, nextIndex);

          setEpisodes(prev => [...prev, ...nextChunk]);
          currentIndex = nextIndex;

          if (currentIndex < autoLimit && currentIndex < sortedEpisodes.length) {
            setTimeout(loadNextAutoChunk, 150);
          }
        };

        setTimeout(loadNextAutoChunk, 100);
      }
    } catch (e) {
      if (activeFeedRef.current === podcast.feedUrl) {
        console.error(e);
        setError(e instanceof PrivateFeedError ? e.message : 'Could not load episodes from this feed. Check the feed URL or try again later.');
        setIsLoadingEpisodes(false);
      }
    }
  };

  const handleSortChange = useCallback((order: SortOrder) => {
    if (!selectedPodcast) return;

    updateState(prev => ({
      ...prev,
      podcastSortOrders: {
        ...prev.podcastSortOrders,
        [selectedPodcast.feedUrl]: order
      }
    }));

    const sorted = sortEpisodes(allEpisodes, order);
    setAllEpisodes(sorted);
    setEpisodes(sorted.slice(0, Math.max(20, episodes.length)));
  }, [selectedPodcast, allEpisodes, episodes.length, updateState, sortEpisodes]);

  const loadMoreEpisodes = useCallback(() => {
    if (episodes.length < allEpisodes.length) {
      const nextChunk = allEpisodes.slice(episodes.length, episodes.length + 100);
      setEpisodes(prev => [...prev, ...nextChunk]);
    }
  }, [episodes.length, allEpisodes]);

  // Bulk Actions
  const handleMarkOlderAsPlayed = useCallback((episode: Episode) => {
    const beforeDate = new Date(episode.pubDate).getTime();
    const olderEpisodeIds = allEpisodes
      .filter(e => new Date(e.pubDate).getTime() < beforeDate)
      .map(e => e.id);

    if (olderEpisodeIds.length === 0) return;

    updateState(prev => {
      const newPlayed = { ...prev.playedEpisodes };
      olderEpisodeIds.forEach(id => {
        newPlayed[id] = true;
      });
      return { ...prev, playedEpisodes: newPlayed };
    });
  }, [allEpisodes, updateState]);

  // New Releases Logic
  const loadNewReleases = useCallback(async () => {
    if (!navigator.onLine || state.subscriptions.length === 0) return;
    setIsRefreshingNewReleases(true);
    try {
      const allNewEpisodes: Episode[] = [];
      const batchSize = 10;
      
      for (let i = 0; i < state.subscriptions.length; i += batchSize) {
        const batch = state.subscriptions.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(sub => fetchPodcastFeed(sub.feedUrl))
        );
        
        results.forEach(result => {
          if (result.status === 'fulfilled') {
            allNewEpisodes.push(...result.value.episodes.slice(0, 10));
          }
        });

        const currentSorted = [...allNewEpisodes].sort((a, b) => {
          const dateA = new Date(a.pubDate).getTime();
          const dateB = new Date(b.pubDate).getTime();
          if (isNaN(dateA) && isNaN(dateB)) return 0;
          if (isNaN(dateA)) return 1;
          if (isNaN(dateB)) return -1;
          return dateB - dateA;
        });

        updateState(prev => ({ 
          ...prev, 
          newReleases: currentSorted.slice(0, 100)
        }));
      }
      
      updateState(prev => ({ 
        ...prev, 
        lastRefresh: Date.now()
      }));
    } catch (err) {
      console.error('Error loading new releases:', err);
    } finally {
      setIsRefreshingNewReleases(false);
    }
  }, [state.subscriptions, updateState]);

  useEffect(() => {
    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();
    const shouldRefresh = !state.lastRefresh || (now - state.lastRefresh > ONE_HOUR);
    
    if (state.subscriptions.length > 0 && shouldRefresh && storageMode) {
      const timer = setTimeout(() => {
        loadNewReleases();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [state.subscriptions.length, state.lastRefresh, storageMode, loadNewReleases]);

  useEffect(() => {
    if (viewMode === 'new-releases' && state.newReleases.length === 0 && state.subscriptions.length > 0) {
      loadNewReleases();
    }
  }, [viewMode, state.newReleases.length, state.subscriptions.length, loadNewReleases]);

  // Queue and Auto-download
  const addToQueue = useCallback((episode: Episode, position: 'top' | 'bottom') => {
    updateState(prev => {
      if (prev.queue.find(e => e.id === episode.id)) return prev;
      
      let newQueue;
      if (position === 'top') {
        if (currentEpisode && prev.queue.length > 0 && prev.queue[0].id === currentEpisode.id) {
          // If something is playing and it's at the top, add after it
          newQueue = [prev.queue[0], episode, ...prev.queue.slice(1)];
        } else {
          newQueue = [episode, ...prev.queue];
        }
      } else {
        newQueue = [...prev.queue, episode];
      }
      return { ...prev, queue: newQueue };
    });
  }, [updateState, currentEpisode]);

  const removeFromQueue = useCallback((episodeId: string) => {
    updateState(prev => {
      if (currentEpisode && episodeId === currentEpisode.id) return prev;
      return { ...prev, queue: prev.queue.filter(e => e.id !== episodeId) };
    });
  }, [updateState, currentEpisode]);

  const reorderQueue = useCallback((episodeId: string, direction: 'up' | 'down') => {
    updateState(prev => {
      const index = prev.queue.findIndex(e => e.id === episodeId);
      if (index === -1) return prev;

      const isPlayingAtTop = currentEpisode && prev.queue.length > 0 && prev.queue[0].id === currentEpisode.id;
      
      if (isPlayingAtTop) {
        if (index === 0) return prev; // Cannot move playing episode down
        if (direction === 'up' && index === 1) return prev; // Cannot move something to position 0
      } else {
        if (direction === 'up' && index === 0) return prev;
      }

      if (direction === 'down' && index === prev.queue.length - 1) return prev;

      const newQueue = [...prev.queue];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      [newQueue[index], newQueue[targetIndex]] = [newQueue[targetIndex], newQueue[index]];
      return { ...prev, queue: newQueue };
    });
  }, [updateState, currentEpisode]);

  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const connected = () => { attemptedDownloads.current.clear(); setOnline(true); };
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => {
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', disconnected);
    };
  }, []);

  useEffect(() => {
    if (!online || !downloadsReady) return;
    const nextToDownload = state.queue.find(e => 
      !downloadedEpisodes.some(d => d.id === e.id) && 
      !downloadingIds.has(e.id) && !attemptedDownloads.current.has(e.id)
    );
    if (nextToDownload) {
      attemptedDownloads.current.add(nextToDownload.id);
      handleDownload(nextToDownload);
    }
  }, [state.queue, downloadedEpisodes, downloadingIds, handleDownload, downloadsReady, online]);

  // OPML and State Handlers
  const handleImportOPML = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const feedUrls = parseOPML(text);
    
    if (feedUrls.length === 0) {
      setError('No podcast feeds found in the OPML file.');
      return;
    }

    setImportingStatus(`Found ${feedUrls.length} feeds. Starting import...`);
    let updatedCount = 0;
    let failCount = 0;

    for (let i = 0; i < feedUrls.length; i++) {
      const url = feedUrls[i];
      setImportingStatus(`Importing ${i + 1}/${feedUrls.length}`);
      try {
        const { podcast } = await fetchPodcastFeed(url);
        let wasAdded = false;
        await updateState(prev => {
          if (prev.subscriptions.some(s => s.feedUrl === url)) return prev;
          wasAdded = true;
          return { ...prev, subscriptions: [...prev.subscriptions, podcast] };
        });
        if (wasAdded) updatedCount++;
      } catch (err) {
        console.error('Failed to import podcast feed:', err);
        failCount++;
      }
    }
    setImportingStatus(`Import complete. Added ${updatedCount} podcasts.${failCount > 0 ? ` (${failCount} failed)` : ''}`);
    setTimeout(() => setImportingStatus(null), 5000);
    e.target.value = '';
  };

  const handleExportOPML = () => {
    const opml = generateOPML(state.subscriptions);
    const blob = new Blob([opml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'subscriptions.opml';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportState = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await importState(file);
      e.target.value = '';
    }
  };

  if (isLoading || (driveLoadingMessage && (setupToken || !storageMode))) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
        <h1 className="text-xl font-bold">{driveLoadingMessage || 'Loading your library...'}</h1>
      </div>
    );
  }

  if (setupToken) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white text-center">
        <h1 className="text-4xl font-black mb-6 bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          Google Drive Setup
        </h1>
        <p className="text-slate-300 mb-8 max-w-md">No existing state file found in your Google Drive. Would you like to start fresh or upload a local file?</p>
        <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 shadow-2xl flex flex-col space-y-6 max-w-sm w-full mx-auto">
          <button onClick={handleCreateDriveProfile} className="bg-emerald-600 hover:bg-emerald-700 p-4 rounded-2xl flex items-center justify-center font-bold text-lg transition-transform hover:scale-105 active:scale-95">
            <Plus className="mr-3" /> Start New Profile
          </button>
          <label className="bg-blue-600 hover:bg-blue-700 p-4 rounded-2xl flex items-center justify-center font-bold text-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer">
            <FolderOpen className="mr-3" /> Upload Local State
            <input type="file" accept=".json" className="hidden" onChange={handleUploadLocalStateToDrive} />
          </label>
        </div>
      </div>
    );
  }

  if (isFileSystemAccessSupported && !fileHandle && storageMode !== 'google-drive') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white text-center">
        <h1 className="text-5xl font-black mb-12 bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          Podcast Player
        </h1>
        <div className="bg-slate-800 p-10 rounded-3xl border border-slate-700 shadow-2xl flex flex-col space-y-6 max-w-sm w-full mx-auto">
          <button onClick={() => loginWithGoogle()} className="bg-white text-slate-900 hover:bg-slate-100 p-5 rounded-2xl flex items-center justify-center font-bold text-lg transition-transform hover:scale-105 active:scale-95">
            <Cloud className="mr-3 text-blue-600" /> Sign in with Google
          </button>
          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-slate-600"></div>
            <span className="flex-shrink-0 mx-4 text-slate-500 text-sm font-semibold">OR</span>
            <div className="flex-grow border-t border-slate-600"></div>
          </div>
          <button onClick={selectFile} className="bg-blue-600 hover:bg-blue-700 p-5 rounded-2xl flex items-center justify-center font-bold text-lg transition-transform hover:scale-105 active:scale-95">
            <FolderOpen className="mr-3" /> Open Local State
          </button>
          <button onClick={createNewFile} className="bg-slate-700 hover:bg-slate-600 p-5 rounded-2xl flex items-center justify-center font-bold text-lg transition-transform hover:scale-105 active:scale-95">
            <Plus className="mr-3" /> Create New Local File
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex select-none font-sans overflow-hidden">
      <div className={showLibrary ? 'fixed inset-x-0 top-12 bottom-32 z-40 overflow-auto bg-slate-900 md:static md:block' : 'hidden md:block'}>
        <Sidebar
          state={state}
          viewMode={viewMode}
          setViewMode={mode => { switchView(mode); setShowLibrary(false); }}
          selectedPodcast={selectedPodcast}
          selectPodcast={podcast => { selectPodcast(podcast); setShowLibrary(false); }}
          handleUnsubscribe={handleUnsubscribe}
          handleImportOPML={handleImportOPML}
          handleExportOPML={handleExportOPML}
          handleImportState={handleImportState}
          exportState={exportState}
        />
      </div>
      <main className="min-w-0 flex-1 flex flex-col pb-44 md:pb-32 overflow-hidden">
        <div className="flex flex-wrap items-center justify-end gap-3 px-6 pt-3 text-sm">
          <button className="mr-auto text-blue-300 md:hidden" aria-expanded={showLibrary} onClick={() => setShowLibrary(!showLibrary)}>Library</button>
          {storageMode !== 'google-drive' ? (
            <button className="text-blue-300" disabled={!!driveLoadingMessage} onClick={() => loginWithGoogle()}>{driveLoadingMessage || 'Connect Google Drive'}</button>
          ) : syncStatus === 'Reconnect Google Drive' ? (
            <button className="text-blue-300" onClick={() => loginWithGoogle()}>Reconnect Google Drive</button>
          ) : (
            <>
              <span role="status" className="text-slate-400">{syncStatus}</span>
              <button className="text-blue-300" onClick={refreshDrive}>Refresh sync</button>
            </>
          )}
          {storageError && <span role="alert" className="text-red-300">{storageError}</span>}
        </div>
        {offer && (hasRemoteOffer || (!isPlaying && viewMode === 'search' && !selectedPodcast && !selectedEpisode && !searchResults.length)) && (
          <section className="mx-4 mt-4 rounded-2xl border border-slate-700 bg-slate-900 p-4 md:mx-6">
            <p className="text-sm text-slate-300">{state.subscriptions.find(p => p.feedUrl === offer.episode.podcastId)?.title || offer.episode.podcastId}</p>
            <h2 className="mb-3 font-bold">{offer.episode.title}</h2>
            <button className="rounded-lg bg-blue-600 px-4 py-2 font-semibold" onClick={continueListening}>
              Continue listening <span className="ml-2 font-mono">{formatTime(offer.time)}</span>
            </button>
          </section>
        )}
        <Header 
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          urlInput={urlInput}
          setUrlInput={setUrlInput}
          handleSearch={handleSearch}
          handleAddByUrl={handleAddByUrl}
          isAddingByUrl={isAddingByUrl}
          error={error}
          importingStatus={importingStatus}
        />

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          {selectedEpisode ? (
            <EpisodeDescriptionView 
              episode={selectedEpisode}
              podcast={state.subscriptions.find(s => s.feedUrl === selectedEpisode.podcastId) || selectedPodcast || undefined}
              onBack={() => setSelectedEpisode(null)}
              onPlay={playEpisode}
              isCurrent={currentEpisode?.id === selectedEpisode.id}
              isPlaying={isPlaying}
              onAddToQueue={addToQueue}
              onDownload={handleDownload}
              onDeleteDownload={handleDeleteDownload}
              downloadStatus={
                downloadedEpisodes.some(d => d.id === selectedEpisode.id) 
                  ? 'downloaded' 
                  : (downloadingIds.has(selectedEpisode.id) ? 'downloading' : 'none')
              }
            />
          ) : viewMode === 'downloads' ? (
            <DownloadsView 
              state={state}
              downloadedEpisodes={downloadedEpisodes}
              currentEpisode={currentEpisode}
              isPlaying={isPlaying}
              playEpisode={playEpisode}
              onShowDescription={setSelectedEpisode}
              handleDownload={handleDownload}
              handleDeleteDownload={handleDeleteDownload}
              addToQueue={addToQueue}
              toggleEpisodePlayed={toggleEpisodePlayed}
            />
          ) : viewMode === 'new-releases' ? (
            <NewReleasesView 
              state={state}
              isRefreshingNewReleases={isRefreshingNewReleases}
              loadNewReleases={loadNewReleases}
              toggleHidePlayed={toggleHidePlayed}
              currentEpisode={currentEpisode}
              isPlaying={isPlaying}
              playEpisode={playEpisode}
              onShowDescription={setSelectedEpisode}
              downloadedEpisodes={downloadedEpisodes}
              downloadingIds={downloadingIds}
              handleDownload={handleDownload}
              handleDeleteDownload={handleDeleteDownload}
              addToQueue={addToQueue}
              toggleEpisodePlayed={toggleEpisodePlayed}
            />
          ) : searchResults.length > 0 ? (
            <SearchResultsView 
              searchResults={searchResults}
              handleSubscribe={handleSubscribe}
            />
          ) : selectedPodcast ? (
            <PodcastView 
              state={state}
              selectedPodcast={selectedPodcast}
              isLoadingEpisodes={isLoadingEpisodes}
              episodes={episodes}
              allEpisodes={allEpisodes}
              currentEpisode={currentEpisode}
              isPlaying={isPlaying}
              playEpisode={playEpisode}
              onShowDescription={setSelectedEpisode}
              downloadedEpisodes={downloadedEpisodes}
              downloadingIds={downloadingIds}
              handleDownload={handleDownload}
              handleDeleteDownload={handleDeleteDownload}
              addToQueue={addToQueue}
              toggleEpisodePlayed={toggleEpisodePlayed}
              handleMarkOlderAsPlayed={handleMarkOlderAsPlayed}
              toggleHidePlayed={toggleHidePlayed}
              handleSortChange={handleSortChange}
              loadMoreEpisodes={loadMoreEpisodes}
            />
          ) : !offer && (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
               <Loader2 size={64} className="mb-4 opacity-5" />
               <p className="text-lg font-bold opacity-20 text-center">Find something to listen to</p>
            </div>
          )}
        </div>
      </main>

      <PodcastPlayer 
        state={state}
        currentEpisode={currentEpisode}
        playingPodcast={playingPodcast}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        togglePlay={togglePlay}
        playEpisode={playEpisode}
        skip={skip}
        handleSeek={handleSeek}
        formatTime={formatTime}
        playbackError={playbackError}
        retry={retry}
        reorderQueue={reorderQueue}
        removeFromQueue={removeFromQueue}
      />
      <audio 
        ref={audioRef} 
        preload="metadata"
        {...audioEvents}
        className="hidden" 
      />
    </div>
  );
}
