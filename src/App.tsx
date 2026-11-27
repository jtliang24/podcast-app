import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useDriveLogin } from './hooks/useDriveLogin';
import { searchStateFile, createStateFile } from './services/driveService';
import { useFileSystem } from './hooks/useFileSystem';
import { syncNetwork, useDownloadConnection } from './hooks/useDownloadConnection';
import type { DownloadConnection } from './services/android';
import { usePodcastPlayer } from './hooks/usePodcastPlayer';
import { useAndroidPodcastPlayer } from './hooks/useAndroidPodcastPlayer';
import { useDownloadPolicy, useDownloadStorage } from './hooks/useDownloads';
import { AndroidFiles, isAndroid } from './services/android';
import { fetchPodcastFeed, PrivateFeedError, searchPodcasts, parseOPML, generateOPML } from './services/podcastService';
import { getPreferences } from './services/preferences';
import { latestEpisodeRelease, releaseDatesByPodcast } from './services/subscriptionSort';
import { moveQueuedEpisode, normalizeState, orderedQueue, queueEpisode, removeQueuedEpisode } from './services/playbackQueue';
import type { Podcast, Episode, SortOrder, QueueEpisode, QueueTier } from './types';
import { ArrowLeft, Loader2, FolderOpen, Plus, Cloud, X } from 'lucide-react';
import { INITIAL_STATE } from './types';

// Components
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import PodcastPlayer from './components/PodcastPlayer';
import QueueView from './components/QueueView';
import NewReleasesView from './components/NewReleasesView';
import DownloadsView from './components/DownloadsView';
import PodcastView from './components/PodcastView';
import SearchResultsView from './components/SearchResultsView';
import EpisodeDescriptionView from './components/EpisodeDescriptionView';
import ReportBugButton from './components/ReportBugButton';
import SettingsButton from './components/SettingsButton';
import DownloadConfirmation from './components/DownloadConfirmation';

const usePlayer = isAndroid ? useAndroidPodcastPlayer : usePodcastPlayer;

export default function App() {
  const connection = useDownloadConnection();
  const storage = useFileSystem(syncNetwork(connection));
  const downloads = useDownloadStorage();
  const profile = storage.driveFileId && storage.storageMode === 'google-drive'
    ? `drive:${storage.driveFileId}` : `${storage.storageMode}:${storage.localLibraryId}`;
  // A storage switch starts a new player. Reconnecting the same library keeps its audio element.
  return <Library key={profile} profile={profile} storage={storage} downloads={downloads} connection={connection} />;
}

function Library({ storage, profile, downloads, connection }: {
  storage: ReturnType<typeof useFileSystem>;
  profile: string;
  downloads: ReturnType<typeof useDownloadStorage>;
  connection: DownloadConnection | null;
}) {
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
    driveReady,
    syncStatus,
    storageError,
    remoteSession,
    refreshDrive,
    setSyncPlayback,
    linkedFile,
    reconnectFile,
    choosingFile,
    linkAndroidFile,
  } = storage;

  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [driveLoadingMessage, setDriveLoadingMessage] = useState<string | null>(null);

  const loginWithGoogle = useDriveLogin({
    onSuccess: async (token) => {
      setDriveLoadingMessage('Searching for state file...');
      try {
        const expected = storageMode === 'google-drive' ? driveFileId : null;
        const fileId = await searchStateFile(token, expected);
        if (fileId) {
          await connectDrive(token, fileId);
        } else if (expected) {
          alert('Reconnect with the Google account that owns this library.');
        } else {
          // File not found, enter setup phase
          setSetupToken(token);
        }
      } catch (err) {
        console.error('Drive Error:', err);
        alert('Failed to connect to Google Drive.');
      } finally {
        setDriveLoadingMessage(null);
      }
    },
    onError: (message) => {
      alert(message || 'Failed to authorize Google Drive.');
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
        const newState = normalizeState(JSON.parse(text));
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

  const ready = !isLoading && !setupToken && (storageMode === 'google-drive'
    ? driveReady : !isFileSystemAccessSupported || !!fileHandle);
  const {
    page, previousPage, searchInput, visit, contentRef, queueButton,
    showLibrary, setShowLibrary, setSearchInput, goTo, back, isCurrentVisit, updatePage,
  } = useAppNavigation(ready);
  const listPage = page.kind === 'episode' ? previousPage : page;
  const viewMode = listPage?.kind === 'downloads' || listPage?.kind === 'new-releases' ? listPage.kind : 'search';
  const queueOpen = page.kind === 'queue';
  const podcastPage = page.kind === 'podcast' ? page : null;
  const selectedPodcast = listPage?.kind === 'podcast' ? listPage.podcast : null;
  const selectedEpisode = page.kind === 'episode' ? page.episode : null;
  const [urlInput, setUrlInput] = useState('');
  const [addingVisit, setAddingVisit] = useState<number | null>(null);
  const [isRefreshingNewReleases, setIsRefreshingNewReleases] = useState(false);
  const attemptedReleaseDateBackfill = useRef(false);
  const releasesRequestInFlight = useRef(false);
  const { downloadsReady, downloadedEpisodes, downloadingIds, removeDownload, removeFinishedDownloads } = downloads;

  const [actionError, setActionError] = useState<{ visit: number; message: string } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isRemovingFinishedDownloads, setIsRemovingFinishedDownloads] = useState(false);
  const [importingStatus, setImportingStatus] = useState<string | null>(null);
  const preferences = getPreferences(state);
  const { skipBackwardSeconds, skipForwardSeconds, autoRemoveFinishedDownloads } = preferences;

  const setError = (message: string | null) => setActionError(message ? { visit, message } : null);

  const handleDeleteDownload = useCallback(async (episodeId: string) => {
    try {
      await removeDownload(episodeId);
    } catch {
      setDownloadError('Could not delete this download.');
    }
  }, [removeDownload]);

  const handleRemoveFinishedDownloads = async (ids: string[]) => {
    setIsRemovingFinishedDownloads(true);
    setDownloadError(null);
    try {
      const hasFailures = await removeFinishedDownloads(ids);
      if (hasFailures) setDownloadError('Could not remove all finished downloads.');
    } finally {
      setIsRemovingFinishedDownloads(false);
    }
  };

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
    playbackReady,
    hasRemoteOffer,
    togglePlay,
    skip,
    seek,
    formatTime,
    playEpisode
  } = usePlayer({
    state, profile, ready, skipBackwardSeconds, skipForwardSeconds,
    updateState, downloadedEpisodes, downloadsReady, remoteSession,
    autoRemoveFinishedDownloads, finishDownload: downloads.finishDownload, refreshDownloads: downloads.refreshDownloads,
  });
  const currentId = currentEpisode?.id ?? state.lastPlayingEpisode?.id;
  const waiting = useMemo(() => currentId ? removeQueuedEpisode(state.queue, currentId) : state.queue,
    [state.queue, currentId]);
  const downloadQueue = useMemo(() => {
    if (!playbackReady) return [];
    const episodes = orderedQueue(waiting);
    const active = currentEpisode ?? state.lastPlayingEpisode;
    return active ? [active, ...episodes] : episodes;
  }, [playbackReady, waiting, currentEpisode, state.lastPlayingEpisode]);

  // Download Management
  const { requestDownload: handleDownload, confirmation, answerConfirmation } = useDownloadPolicy({
    connection, ready, queue: downloadQueue, preferences, storage: downloads, onError: setDownloadError,
  });

  useEffect(() => {
    setSyncPlayback(isPlaying);
    return () => setSyncPlayback(false);
  }, [isPlaying, setSyncPlayback]);

  // Keyboard Shortcuts
  useEffect(() => {
    if (!ready) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.target instanceof Element)) return;
      if (e.target.closest('input, select, textarea, [contenteditable], dialog:not(#now-playing)')) return;
      if (e.code === 'Space') {
        if (e.target.closest('button')) return;
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowRight') {
        skip(skipForwardSeconds);
      } else if (e.code === 'ArrowLeft') {
        skip(-skipBackwardSeconds);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [ready, togglePlay, skip, skipBackwardSeconds, skipForwardSeconds]);

  // Search and Subscription Handlers
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchInput.trim();
    if (!query) return;
    const destination = { kind: 'search' as const, query };
    setError(null);
    if (page.kind === 'search' && page.query === query) {
      if (page.results) updatePage(visit, destination);
    } else {
      goTo(destination);
    }
  };

  const addSubscription = async (podcast: Podcast, episodes?: Episode[]) => {
    const addedAt = Date.now();
    const releaseDate = episodes ? latestEpisodeRelease(episodes) : undefined;
    let added = false;
    await updateState(prev => {
      if (prev.subscriptions.some(s => s.feedUrl === podcast.feedUrl)) return prev;
      added = true;
      return {
        ...prev,
        subscriptions: [...prev.subscriptions, { ...podcast, addedAt }],
        podcastReleaseDates: releaseDate === undefined ? prev.podcastReleaseDates
          : { ...prev.podcastReleaseDates, [podcast.feedUrl]: releaseDate },
      };
    });
    return added;
  };

  const savePodcastReleaseDate = useCallback((feedUrl: string, episodes: Episode[]) => {
    const releaseDate = latestEpisodeRelease(episodes);
    void updateState(prev => {
      if (prev.podcastReleaseDates?.[feedUrl] === releaseDate
        || !prev.subscriptions.some(podcast => podcast.feedUrl === feedUrl)) return prev;
      return { ...prev, podcastReleaseDates: { ...prev.podcastReleaseDates, [feedUrl]: releaseDate } };
    });
  }, [updateState]);

  const handleAddByUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || addingVisit === visit) return;
    setError(null);
    setAddingVisit(visit);
    try {
      const { podcast, episodes } = await fetchPodcastFeed(urlInput.trim());
      if (!isCurrentVisit(visit)) return;
      const added = await addSubscription(podcast, episodes);
      if (!isCurrentVisit(visit)) return;
      if (!added) {
        setError('Already subscribed to this podcast');
        return;
      }

      setUrlInput('');
      selectPodcast(podcast, episodes);
    } catch (err) {
      if (!isCurrentVisit(visit)) return;
      console.error(err);
      setError(err instanceof PrivateFeedError ? err.message : 'Failed to fetch podcast from URL. Ensure it is a valid RSS feed.');
    } finally {
      setAddingVisit(pending => pending === visit ? null : pending);
    }
  };

  const handleSubscribe = async (podcast: Podcast) => {
    if (!await addSubscription(podcast)) return;
    try {
      const { episodes } = await fetchPodcastFeed(podcast.feedUrl);
      savePodcastReleaseDate(podcast.feedUrl, episodes);
    } catch {
      // Keep the subscription and let the next feed refresh retry.
    }
  };

  const handleUnsubscribe = async (feedUrl: string) => {
    updateState(prev => ({ 
      ...prev, 
      subscriptions: prev.subscriptions.filter(s => s.feedUrl !== feedUrl) 
    }));
    if (selectedPodcast?.feedUrl === feedUrl || selectedEpisode?.podcastId === feedUrl) {
      setShowLibrary(false);
      back();
    }
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

  const selectPodcast = (podcast: Podcast, loadedEpisodes?: Episode[]) => {
    setShowLibrary(false);
    const destination = {
      kind: 'podcast' as const, podcast, episodes: loadedEpisodes,
      visibleCount: loadedEpisodes && loadedEpisodes.length > 100 ? 20 : loadedEpisodes?.length ?? 0,
    };
    if (podcastPage?.podcast.feedUrl === podcast.feedUrl) {
      if (podcastPage.episodes || podcastPage.error || loadedEpisodes) updatePage(visit, destination);
    } else {
      goTo(destination);
    }
  };

  useEffect(() => {
    if (!ready) return;
    let live = true;
    if (page.kind === 'search' && !page.results) {
      void searchPodcasts(page.query).then(results => {
        if (live) updatePage(visit, { ...page, results });
      });
    }
    if (page.kind === 'podcast' && !page.episodes && !page.error) {
      const { feedUrl } = page.podcast;
      void fetchPodcastFeed(feedUrl).then(({ episodes }) => {
        if (!live || !isCurrentVisit(visit)) return;
        savePodcastReleaseDate(feedUrl, episodes);
        updatePage(visit, { ...page, episodes, visibleCount: episodes.length <= 100 ? episodes.length : 20 });
      }).catch(err => {
        if (!live || !isCurrentVisit(visit)) return;
        console.error(err);
        const error = err instanceof PrivateFeedError ? err.message
          : 'Could not load episodes from this feed. Check the feed URL or try again later.';
        updatePage(visit, { ...page, error });
      });
    }
    return () => { live = false; };
  }, [ready, page, visit, isCurrentVisit, savePodcastReleaseDate, updatePage]);

  const podcastEpisodes = podcastPage?.episodes;
  const order = podcastPage ? state.podcastSortOrders[podcastPage.podcast.feedUrl] || 'newest' : 'newest';
  const allEpisodes = useMemo(() => podcastEpisodes ? sortEpisodes(podcastEpisodes, order) : [],
    [podcastEpisodes, order, sortEpisodes]);
  const visibleCount = podcastPage?.visibleCount ?? 0;
  const episodes = useMemo(() => allEpisodes.slice(0, visibleCount), [allEpisodes, visibleCount]);

  useEffect(() => {
    if (!podcastPage || allEpisodes.length <= 100) return;
    const autoLimit = Math.min(120, allEpisodes.length);
    if (visibleCount >= autoLimit) return;
    const timer = setTimeout(() => {
      updatePage(visit, { ...podcastPage, visibleCount: Math.min(visibleCount + 50, autoLimit) });
    }, visibleCount === 20 ? 100 : 150);
    return () => clearTimeout(timer);
  }, [podcastPage, allEpisodes.length, visibleCount, visit, updatePage]);

  const handleSortChange = useCallback((order: SortOrder) => {
    if (!selectedPodcast) return;

    updateState(prev => ({
      ...prev,
      podcastSortOrders: {
        ...prev.podcastSortOrders,
        [selectedPodcast.feedUrl]: order
      }
    }));
  }, [selectedPodcast, updateState]);

  const loadMoreEpisodes = useCallback(() => {
    if (!podcastPage) return;
    updatePage(visit, { ...podcastPage, visibleCount: Math.min(visibleCount + 100, allEpisodes.length) });
  }, [podcastPage, visit, visibleCount, allEpisodes.length, updatePage]);

  const showEpisode = (episode: Episode) => goTo({ kind: 'episode', episode, podcast: selectedPodcast });

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
    if (!ready || !navigator.onLine || state.subscriptions.length === 0 || releasesRequestInFlight.current) return;
    attemptedReleaseDateBackfill.current = true;
    releasesRequestInFlight.current = true;
    setIsRefreshingNewReleases(true);
    try {
      const allNewEpisodes: Episode[] = [];
      const batchSize = 10;
      
      for (let i = 0; i < state.subscriptions.length; i += batchSize) {
        const batch = state.subscriptions.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(sub => fetchPodcastFeed(sub.feedUrl))
        );
        
        const releaseDates: Record<string, number | null> = {};
        results.forEach(result => {
          if (result.status === 'fulfilled') {
            const { podcast, episodes } = result.value;
            releaseDates[podcast.feedUrl] = latestEpisodeRelease(episodes);
            allNewEpisodes.push(...episodes.slice(0, 10));
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
          newReleases: currentSorted.slice(0, 100),
          podcastReleaseDates: {
            ...Object.fromEntries(releaseDatesByPodcast(prev.newReleases)),
            ...prev.podcastReleaseDates,
            ...releaseDates,
          },
        }));
      }
      
      updateState(prev => ({ 
        ...prev, 
        lastRefresh: Date.now()
      }));
    } catch (err) {
      console.error('Error loading new releases:', err);
    } finally {
      releasesRequestInFlight.current = false;
      setIsRefreshingNewReleases(false);
    }
  }, [ready, state.subscriptions, updateState]);

  const needsReleaseDates = state.subscriptions.some(podcast => state.podcastReleaseDates?.[podcast.feedUrl] === undefined);
  useEffect(() => {
    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();
    const shouldRefresh = (needsReleaseDates && !attemptedReleaseDateBackfill.current)
      || !state.lastRefresh || (now - state.lastRefresh > ONE_HOUR);
    
    if (ready && state.subscriptions.length > 0 && shouldRefresh && storageMode) {
      const timer = setTimeout(() => {
        loadNewReleases();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [ready, state.subscriptions.length, state.lastRefresh, needsReleaseDates, storageMode, loadNewReleases]);

  useEffect(() => {
    if (viewMode === 'new-releases' && state.newReleases.length === 0 && state.subscriptions.length > 0) {
      loadNewReleases();
    }
  }, [viewMode, state.newReleases.length, state.subscriptions.length, loadNewReleases]);

  const addToQueue = useCallback<QueueEpisode>((episode, action) => {
    if (episode.id === currentId) return;
    void updateState(prev => {
      const queue = queueEpisode(prev.queue, episode, action);
      return queue === prev.queue ? prev : { ...prev, queue };
    });
  }, [updateState, currentId]);

  const removeFromQueue = (id: string) => {
    void updateState(prev => {
      const queue = removeQueuedEpisode(prev.queue, id);
      return queue === prev.queue ? prev : { ...prev, queue };
    });
  };

  const moveInQueue = (id: string, tier: QueueTier, beforeId?: string) => {
    void updateState(prev => {
      const queue = moveQueuedEpisode(prev.queue, id, tier, beforeId);
      return queue === prev.queue ? prev : { ...prev, queue };
    });
  };

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
        const { podcast, episodes } = await fetchPodcastFeed(url);
        if (await addSubscription(podcast, episodes)) updatedCount++;
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
    if (isAndroid) {
      void AndroidFiles.exportFile({ name: 'subscriptions.opml', mimeType: 'text/xml', content: opml })
        .catch(() => setError('Could not export your subscriptions.'));
      return;
    }
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
        <div className="mt-6"><ReportBugButton /></div>
      </div>
    );
  }

  if (storageMode === 'google-drive' && !driveReady) {
    const offline = syncNetwork(connection) === 'offline';
    const reconnect = syncStatus === 'Reconnect Google Drive';
    const syncing = !offline && (syncStatus === 'Syncing' || !!driveLoadingMessage);
    const message = driveLoadingMessage || storageError || (offline
      ? 'Connect to the internet to finish syncing your library.'
      : reconnect ? 'Reconnect Google Drive to finish syncing your library.'
      : syncing ? 'Restoring your library and playback from Google Drive.'
      : 'The initial sync is paused. Retry to continue.');
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4 p-4 text-center text-white">
        {syncing && <Loader2 aria-hidden="true" className="animate-spin text-blue-500" size={48} />}
        <h1 className="text-xl font-bold">Syncing your library</h1>
        <p role="status" className="max-w-sm text-slate-300">{message}</p>
        {!offline && !syncing && (
          <button className="rounded-lg bg-blue-600 px-4 py-2 font-semibold" onClick={reconnect ? () => loginWithGoogle() : refreshDrive}>
            {reconnect ? 'Reconnect Google Drive' : 'Retry sync'}
          </button>
        )}
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
        <div className="mt-6"><ReportBugButton /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex select-none font-sans overflow-hidden">
      <div className={queueOpen ? 'hidden' : showLibrary ? 'fixed inset-x-0 top-12 bottom-32 z-40 overflow-auto bg-slate-900 md:static md:block' : 'hidden md:block'}>
        <Sidebar
          state={state}
          onSubscriptionSortChange={change => void updateState(prev => ({ ...prev, ...change }))}
          viewMode={viewMode}
          setViewMode={mode => {
            setShowLibrary(false);
            if (page.kind !== mode) goTo({ kind: mode });
          }}
          selectedPodcast={selectedPodcast}
          selectPodcast={selectPodcast}
          handleUnsubscribe={handleUnsubscribe}
          handleImportOPML={handleImportOPML}
          handleExportOPML={handleExportOPML}
        />
      </div>
      <main className={`min-w-0 flex-1 flex-col pb-44 md:pb-32 overflow-hidden ${queueOpen ? 'hidden' : 'flex'}`}>
        <div className="flex flex-wrap items-center justify-end gap-3 px-6 pt-3 text-sm">
          <button className="mr-auto text-blue-300 md:hidden" aria-expanded={showLibrary} onClick={() => setShowLibrary(!showLibrary)}>Library</button>
          <SettingsButton
            preferences={preferences}
            onChange={change => void updateState(previous => ({ ...previous, ...change }))}
            onImport={handleImportState}
            onExport={exportState}
            storageError={storageError}
            androidFileActions={storageMode === 'android' ? { linkedFile, reconnectFile, choosingFile, linkAndroidFile } : undefined}
          />
          <ReportBugButton />
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
        {downloadError && (
          <div className="fixed inset-x-4 bottom-44 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-xl border border-red-400/40 bg-slate-900 px-4 py-2 text-sm text-red-300 shadow-xl md:bottom-32">
            <p role="alert" className="flex-1">{downloadError}</p>
            <button type="button" aria-label="Dismiss download message" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-slate-800" onClick={() => setDownloadError(null)}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        )}
        {offer && (hasRemoteOffer || (!isPlaying && page.kind === 'home')) && (
          <section className="mx-4 mt-4 rounded-2xl border border-slate-700 bg-slate-900 p-4 md:mx-6">
            <p className="text-sm text-slate-300">{state.subscriptions.find(p => p.feedUrl === offer.episode.podcastId)?.title || offer.episode.podcastId}</p>
            <h2 className="mb-3 font-bold">{offer.episode.title}</h2>
            <button className="rounded-lg bg-blue-600 px-4 py-2 font-semibold" onClick={continueListening}>
              Continue listening <span className="ml-2 font-mono">{formatTime(offer.time)}</span>
            </button>
          </section>
        )}
        <Header 
          searchQuery={searchInput}
          setSearchQuery={setSearchInput}
          urlInput={urlInput}
          setUrlInput={setUrlInput}
          handleSearch={handleSearch}
          handleAddByUrl={handleAddByUrl}
          isAddingByUrl={addingVisit === visit}
          error={(actionError?.visit === visit ? actionError.message : null) ?? podcastPage?.error ?? null}
          importingStatus={importingStatus}
        />

        <div ref={contentRef} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          {page.kind !== 'home' && page.kind !== 'episode' && !queueOpen && (
            <button type="button" onClick={back} className="mb-3 flex min-h-11 items-center gap-2 rounded text-sm font-semibold text-slate-300 hover:text-white">
              <ArrowLeft size={20} aria-hidden="true" /> Back
            </button>
          )}
          {page.kind === 'episode' ? (
            <EpisodeDescriptionView 
              episode={page.episode}
              podcast={state.subscriptions.find(s => s.feedUrl === page.episode.podcastId) || page.podcast || undefined}
              onBack={back}
              onPlay={playEpisode}
              isCurrent={currentEpisode?.id === page.episode.id}
              isPlaying={isPlaying}
              onAddToQueue={addToQueue}
              onDownload={handleDownload}
              onDeleteDownload={handleDeleteDownload}
              downloadStatus={
                downloadedEpisodes.some(d => d.id === page.episode.id)
                  ? 'downloaded' 
                  : (downloadingIds.has(page.episode.id) ? 'downloading' : 'none')
              }
            />
          ) : page.kind === 'downloads' ? (
            <DownloadsView 
              state={state}
              downloadedEpisodes={downloadedEpisodes}
              currentEpisode={currentEpisode}
              isPlaying={isPlaying}
              playEpisode={playEpisode}
              onShowDescription={showEpisode}
              handleDownload={handleDownload}
              handleDeleteDownload={handleDeleteDownload}
              onRemoveFinishedDownloads={handleRemoveFinishedDownloads}
              isRemovingFinishedDownloads={isRemovingFinishedDownloads}
              addToQueue={addToQueue}
              toggleEpisodePlayed={toggleEpisodePlayed}
            />
          ) : page.kind === 'new-releases' ? (
            <NewReleasesView 
              state={state}
              isRefreshingNewReleases={isRefreshingNewReleases}
              loadNewReleases={loadNewReleases}
              toggleHidePlayed={toggleHidePlayed}
              currentEpisode={currentEpisode}
              isPlaying={isPlaying}
              playEpisode={playEpisode}
              onShowDescription={showEpisode}
              downloadedEpisodes={downloadedEpisodes}
              downloadingIds={downloadingIds}
              handleDownload={handleDownload}
              handleDeleteDownload={handleDeleteDownload}
              addToQueue={addToQueue}
              toggleEpisodePlayed={toggleEpisodePlayed}
            />
          ) : page.kind === 'search' ? (
            <SearchResultsView
              searchResults={page.results}
              subscriptions={state.subscriptions}
              selectPodcast={selectPodcast}
              handleSubscribe={handleSubscribe}
            />
          ) : podcastPage ? (
            <PodcastView 
              state={state}
              selectedPodcast={podcastPage.podcast}
              isLoadingEpisodes={!podcastPage.episodes && !podcastPage.error}
              episodes={episodes}
              allEpisodes={allEpisodes}
              currentEpisode={currentEpisode}
              isPlaying={isPlaying}
              playEpisode={playEpisode}
              onShowDescription={showEpisode}
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

      {queueOpen && (
        <main className="min-w-0 flex-1 px-4 pt-6 pb-48 md:px-8 md:pb-36">
          <QueueView
            queue={waiting}
            currentEpisode={currentEpisode ?? state.lastPlayingEpisode ?? null}
            podcasts={state.subscriptions}
            onBack={back}
            onMove={moveInQueue}
            onPlay={playEpisode}
            onRemove={removeFromQueue}
          />
        </main>
      )}
      <DownloadConfirmation episode={confirmation} answer={answerConfirmation} />
      <PodcastPlayer
        queueButton={queueButton}
        queueOpen={queueOpen}
        queueCount={waiting.primary.length + waiting.secondary.length}
        onQueue={() => queueOpen ? back() : goTo({ kind: 'queue' })}
        currentEpisode={currentEpisode}
        playingPodcast={playingPodcast}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        togglePlay={togglePlay}
        skip={skip}
        skipBackwardSeconds={skipBackwardSeconds}
        skipForwardSeconds={skipForwardSeconds}
        seek={seek}
        formatTime={formatTime}
        playbackError={playbackError}
        retry={retry}
      />
      {!isAndroid && <audio
        ref={audioRef} 
        preload="metadata"
        {...audioEvents}
        className="hidden" 
      />}
    </div>
  );
}
