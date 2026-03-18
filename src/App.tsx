import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFileSystem } from './hooks/useFileSystem';
import { fetchPodcastFeed, searchPodcasts, parseOPML, generateOPML } from './services/podcastService';
import { saveDownload, getAllDownloadedEpisodes, getAudioBlob, deleteDownload } from './services/storageService';
import type { Podcast, Episode, PlaybackProgress } from './types';
import { Search, Plus, Play, Pause, FolderOpen, Download, Upload, Trash2, AlertCircle, RotateCcw, RotateCw, Loader2, ChevronDown, ArrowDownToLine, CheckCircle2, HardDrive, FileJson, Save, List, X, ChevronUp, MoreVertical } from 'lucide-react';

// Sub-component for individual episodes to prevent entire list re-renders
const EpisodeItem = React.memo(({ 
  episode, 
  isCurrent, 
  isPlaying, 
  onPlay,
  downloadStatus,
  onDownload,
  onDeleteDownload,
  onAddToQueue
}: { 
  episode: Episode, 
  isCurrent: boolean, 
  isPlaying: boolean, 
  onPlay: (e: Episode) => void,
  downloadStatus: 'none' | 'downloading' | 'downloaded',
  onDownload: (e: Episode) => void,
  onDeleteDownload: (id: string) => void,
  onAddToQueue: (e: Episode, position: 'top' | 'bottom') => void
}) => {
  const dateStr = useMemo(() => new Date(episode.pubDate).toLocaleDateString(), [episode.pubDate]);
  const [showMenu, setShowMenu] = useState(false);
  
  return (
    <div className={`w-full p-4 rounded-xl hover:bg-white/5 flex items-center justify-between group transition-colors ${isCurrent ? 'bg-blue-500/10' : ''}`}>
      <button onClick={() => onPlay(episode)} className="flex-1 text-left min-w-0 mr-4 cursor-pointer">
        <div className={`font-bold text-sm truncate ${isCurrent ? 'text-blue-400' : 'text-slate-200'}`}>{episode.title}</div>
        <div className="text-[10px] text-slate-500 mt-1">{dateStr}</div>
      </button>
      
      <div className="flex items-center space-x-2">
        <div className="relative">
          <button 
            onClick={() => setShowMenu(!showMenu)} 
            onBlur={() => setTimeout(() => setShowMenu(false), 200)}
            className="p-2 rounded-full text-slate-400 hover:text-white bg-slate-800 opacity-0 group-hover:opacity-100 transition-all"
          >
            <MoreVertical size={16} />
          </button>
          {showMenu && (
            <div className="absolute right-0 bottom-full mb-2 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
              <button 
                onClick={() => onAddToQueue(episode, 'top')}
                className="w-full text-left px-4 py-3 text-xs font-bold hover:bg-blue-600 transition-colors flex items-center"
              >
                <ChevronUp size={14} className="mr-2" /> Play Next
              </button>
              <button 
                onClick={() => onAddToQueue(episode, 'bottom')}
                className="w-full text-left px-4 py-3 text-xs font-bold hover:bg-slate-700 border-t border-slate-700 transition-colors flex items-center"
              >
                <List size={14} className="mr-2" /> Add to Queue
              </button>
            </div>
          )}
        </div>

        {downloadStatus === 'none' && (
          <button onClick={() => onDownload(episode)} className="p-2 rounded-full text-slate-400 hover:text-white bg-slate-800 opacity-0 group-hover:opacity-100 transition-all">
            <ArrowDownToLine size={16} />
          </button>
        )}
        {downloadStatus === 'downloading' && (
          <div className="p-2 text-blue-500">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        {downloadStatus === 'downloaded' && (
          <button onClick={() => onDeleteDownload(episode.id)} className="p-2 rounded-full text-emerald-500 hover:text-red-400 transition-all" title="Delete Download">
            <CheckCircle2 size={16} />
          </button>
        )}

        <button onClick={() => onPlay(episode)} className={`p-2 rounded-full transition-all ${isCurrent ? 'bg-blue-600 shadow-lg scale-110' : 'bg-slate-800 opacity-0 group-hover:opacity-100'}`}>
          {isCurrent && isPlaying ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor" className="ml-0.5"/>}
        </button>
      </div>
    </div>
  );
});

export default function App() {
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
    importState
  } = useFileSystem();

  const [viewMode, setViewMode] = useState<'search' | 'downloads'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Podcast[]>([]);
  const [selectedPodcast, setSelectedPodcast] = useState<Podcast | null>(null);
  const activeFeedRef = useRef<string | null>(null);
  const [allEpisodes, setAllEpisodes] = useState<Episode[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [downloadedEpisodes, setDownloadedEpisodes] = useState<Episode[]>([]);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const [playingPodcast, setPlayingPodcast] = useState<Podcast | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Load downloads on mount
  useEffect(() => {
    getAllDownloadedEpisodes().then(deps => setDownloadedEpisodes(deps)).catch(console.error);
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
  }, [isPlaying, currentEpisode]);

  const saveProgress = useCallback((episodeUrl: string, currentTime: number, duration: number) => {
    if (!storageMode) return;
    const progress: PlaybackProgress = { episodeUrl, currentTime, duration, lastUpdated: Date.now() };
    updateState({ ...state, playbackProgress: { ...state.playbackProgress, [episodeUrl]: progress } });
  }, [storageMode, updateState, state]);

  const togglePlay = useCallback(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        if (currentEpisode) {
          saveProgress(currentEpisode.audioUrl, audioRef.current.currentTime, audioRef.current.duration);
        }
      } else {
        audioRef.current.play().catch(console.error);
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying, currentEpisode, saveProgress]);

  const skip = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime += seconds;
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Fast UI updates
  useEffect(() => {
    const interval = setInterval(() => {
      if (audioRef.current && isPlaying) {
        setCurrentTime(audioRef.current.currentTime);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Slow DISK updates
  useEffect(() => {
    const interval = setInterval(() => {
      if (audioRef.current && currentEpisode && isPlaying) {
        saveProgress(currentEpisode.audioUrl, audioRef.current.currentTime, audioRef.current.duration);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [currentEpisode, isPlaying, saveProgress]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setViewMode('search');
    if (!searchQuery) return;
    setError(null);
    const results = await searchPodcasts(searchQuery);
    setSearchResults(results);
  };

  const handleSubscribe = async (podcast: Podcast) => {
    if (state.subscriptions.find(s => s.feedUrl === podcast.feedUrl)) return;
    updateState({ ...state, subscriptions: [...state.subscriptions, podcast] });
    setSearchResults([]);
    setSearchQuery('');
  };

  const handleUnsubscribe = async (feedUrl: string) => {
    updateState({ ...state, subscriptions: state.subscriptions.filter(s => s.feedUrl !== feedUrl) });
    if (selectedPodcast?.feedUrl === feedUrl) setSelectedPodcast(null);
  };

  const loadMoreEpisodes = useCallback(() => {
    if (episodes.length < allEpisodes.length) {
      const nextChunk = allEpisodes.slice(episodes.length, episodes.length + 100);
      setEpisodes(prev => [...prev, ...nextChunk]);
    }
  }, [episodes.length, allEpisodes]);

  const selectPodcast = async (podcast: Podcast) => {
    setViewMode('search');
    setSelectedPodcast(podcast);
    activeFeedRef.current = podcast.feedUrl;
    setEpisodes([]);
    setAllEpisodes([]);
    setError(null);
    setIsLoadingEpisodes(true);
    
    try {
      const { episodes: fetchedEpisodes } = await fetchPodcastFeed(podcast.feedUrl);
      if (activeFeedRef.current !== podcast.feedUrl) return;

      setAllEpisodes(fetchedEpisodes);
      setIsLoadingEpisodes(false);

      if (fetchedEpisodes.length <= 100) {
        setEpisodes(fetchedEpisodes);
      } else {
        const initialChunk = fetchedEpisodes.slice(0, 20);
        setEpisodes(initialChunk);

        let currentIndex = 20;
        const chunkSize = 50;
        const autoLimit = 120;

        const loadNextAutoChunk = () => {
          if (activeFeedRef.current !== podcast.feedUrl) return;
          if (currentIndex >= autoLimit || currentIndex >= fetchedEpisodes.length) return;

          const nextIndex = Math.min(currentIndex + chunkSize, autoLimit, fetchedEpisodes.length);
          const nextChunk = fetchedEpisodes.slice(currentIndex, nextIndex);
          
          setEpisodes(prev => [...prev, ...nextChunk]);
          currentIndex = nextIndex;

          if (currentIndex < autoLimit && currentIndex < fetchedEpisodes.length) {
            setTimeout(loadNextAutoChunk, 150);
          }
        };

        setTimeout(loadNextAutoChunk, 100);
      }
    } catch (e) { 
      if (activeFeedRef.current === podcast.feedUrl) {
        console.error(e); 
        setError('Failed to load feed. It may be too large or the proxy may be busy.');
        setIsLoadingEpisodes(false);
      }
    }
  };

  const handleDownload = async (episode: Episode) => {
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
  };

  const handleDeleteDownload = async (episodeId: string) => {
    await deleteDownload(episodeId);
    const newDeps = await getAllDownloadedEpisodes();
    setDownloadedEpisodes(newDeps);
  };

  const playEpisode = useCallback(async (episode: Episode) => {
    if (currentEpisode?.id === episode.id) {
      togglePlay();
      return;
    }

    if (audioRef.current && currentEpisode) {
      saveProgress(currentEpisode.audioUrl, audioRef.current.currentTime, audioRef.current.duration);
    }

    const podcast = state.subscriptions.find(s => s.feedUrl === episode.podcastId) || selectedPodcast;
    setPlayingPodcast(podcast);
    setCurrentEpisode(episode);
    setIsPlaying(true);
    if (audioRef.current) {
      const savedProgress = state.playbackProgress[episode.audioUrl];
      
      if (audioRef.current.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioRef.current.src);
      }

      const isDownloaded = downloadedEpisodes.some(d => d.id === episode.id);
      
      if (isDownloaded) {
        const blob = await getAudioBlob(episode.id);
        if (blob) {
          audioRef.current.src = URL.createObjectURL(blob);
        } else {
          audioRef.current.src = episode.audioUrl;
        }
      } else {
        audioRef.current.src = episode.audioUrl;
        handleDownload(episode);
      }
      
      if (savedProgress) {
        audioRef.current.currentTime = savedProgress.currentTime;
        setCurrentTime(savedProgress.currentTime);
      } else {
        setCurrentTime(0);
      }
      audioRef.current.play().catch(console.error);
    }
  }, [currentEpisode, state.playbackProgress, storageMode, downloadedEpisodes, togglePlay, saveProgress, state.subscriptions, selectedPodcast]);

  // Queue management
  const addToQueue = useCallback((episode: Episode, position: 'top' | 'bottom') => {
    if (state.queue.find(e => e.id === episode.id)) return;
    const newQueue = position === 'top' ? [episode, ...state.queue] : [...state.queue, episode];
    updateState({ ...state, queue: newQueue });
  }, [state, updateState]);

  const removeFromQueue = useCallback((episodeId: string) => {
    updateState({ ...state, queue: state.queue.filter(e => e.id !== episodeId) });
  }, [state, updateState]);

  const reorderQueue = useCallback((episodeId: string, direction: 'up' | 'down') => {
    const index = state.queue.findIndex(e => e.id === episodeId);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === state.queue.length - 1) return;

    const newQueue = [...state.queue];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newQueue[index], newQueue[targetIndex]] = [newQueue[targetIndex], newQueue[index]];
    updateState({ ...state, queue: newQueue });
  }, [state, updateState]);

  // Auto-download queued episodes
  useEffect(() => {
    const nextToDownload = state.queue.find(e => 
      !downloadedEpisodes.some(d => d.id === e.id) && 
      !downloadingIds.has(e.id)
    );
    if (nextToDownload) {
      handleDownload(nextToDownload);
    }
  }, [state.queue, downloadedEpisodes, downloadingIds]);

  const handleEpisodeEnded = useCallback(() => {
    if (state.queue.length > 0) {
      const nextEpisode = state.queue[0];
      const newQueue = state.queue.slice(1);
      updateState({ ...state, queue: newQueue });
      playEpisode(nextEpisode);
    } else {
      setIsPlaying(false);
    }
  }, [state.queue, updateState, playEpisode]);

  const handleImportOPML = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const feedUrls = parseOPML(text);
    for (const url of feedUrls) {
      if (!state.subscriptions.find(s => s.feedUrl === url)) {
        try {
          const { podcast } = await fetchPodcastFeed(url);
          updateState({ ...state, subscriptions: [...state.subscriptions, podcast] });
        } catch (e) { console.error(e); }
      }
    }
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
      e.target.value = ''; // Reset input
    }
  };

  // If loading OPFS or waiting for user to select file on desktop
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
        <h1 className="text-xl font-bold">Loading your library...</h1>
      </div>
    );
  }

  // Initial Entry Screen (Desktop with File System Access)
  if (isFileSystemAccessSupported && !fileHandle) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white text-center">
        <h1 className="text-5xl font-black mb-12 bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          Podcast Player
        </h1>
        <div className="bg-slate-800 p-10 rounded-3xl border border-slate-700 shadow-2xl flex flex-col space-y-6 max-w-sm w-full mx-auto">
          <button onClick={selectFile} className="bg-blue-600 hover:bg-blue-700 p-5 rounded-2xl flex items-center justify-center font-bold text-lg transition-transform hover:scale-105 active:scale-95">
            <FolderOpen className="mr-3" /> Open State File
          </button>
          <button onClick={createNewFile} className="bg-slate-700 hover:bg-slate-600 p-5 rounded-2xl flex items-center justify-center font-bold text-lg transition-transform hover:scale-105 active:scale-95">
            <Plus className="mr-3" /> Create New File
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex select-none font-sans overflow-hidden">
      <aside className="w-64 border-r border-slate-800 flex flex-col bg-slate-900">
        <div className="p-6 border-b border-slate-800 font-bold flex justify-between items-center">
          <span className="tracking-tight">Subscriptions</span>
          <div className="flex space-x-2 text-slate-500">
            <label className="cursor-pointer hover:text-white transition-colors" title="Import OPML">
              <Upload size={16} />
              <input type="file" className="hidden" onChange={handleImportOPML} accept=".opml,.xml" />
            </label>
            <button onClick={handleExportOPML} className="hover:text-white transition-colors" title="Export OPML">
              <Download size={16} />
            </button>
          </div>
        </div>
        
        <div className="p-4 border-b border-slate-800 flex flex-col space-y-2">
           <button 
             onClick={() => setViewMode('downloads')}
             className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-colors ${viewMode === 'downloads' ? 'bg-blue-600' : 'hover:bg-slate-800 text-slate-300'}`}
           >
             <HardDrive size={18} />
             <span className="font-bold text-sm">Downloads</span>
           </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {state.subscriptions.map(p => (
            <div key={p.feedUrl} className="group relative">
              <button 
                onClick={() => selectPodcast(p)} 
                className={`w-full text-left p-4 hover:bg-white/5 flex items-center space-x-3 transition-colors ${viewMode === 'search' && selectedPodcast?.feedUrl === p.feedUrl ? 'bg-white/10' : ''}`}
              >
                <img src={p.artworkUrl} className="w-10 h-10 rounded shadow-lg bg-slate-800" alt="" />
                <div className="truncate text-xs font-bold">{p.title}</div>
              </button>
              <button onClick={(e) => { e.stopPropagation(); handleUnsubscribe(p.feedUrl); }} className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Data Portability Section */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/30">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 px-2">Data Portability</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800 hover:bg-slate-700 cursor-pointer transition-colors text-slate-300">
              <FileJson size={16} className="mb-1" />
              <span className="text-[10px] font-bold">Import</span>
              <input type="file" className="hidden" accept=".json" onChange={handleImportState} />
            </label>
            <button onClick={exportState} className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800 hover:bg-slate-700 transition-colors text-slate-300">
              <Save size={16} className="mb-1" />
              <span className="text-[10px] font-bold">Export</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col pb-32 overflow-hidden">
        <header className="p-6 flex flex-col items-center bg-slate-950/50">
          <form onSubmit={handleSearch} className="relative w-full max-w-lg group">
            <Search className="absolute left-4 top-3.5 text-slate-500 group-focus-within:text-blue-500 transition-colors" size={18} />
            <input 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-3 pl-12 pr-4 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              placeholder="Search podcasts..."
            />
          </form>
          {error && (
            <div className="mt-4 flex items-center text-red-400 bg-red-400/10 px-4 py-2 rounded-xl text-xs border border-red-400/20">
              <AlertCircle size={14} className="mr-2" /> {error}
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          {viewMode === 'downloads' ? (
            <div className="animate-in fade-in duration-500">
              <h1 className="text-3xl font-black mb-8">Downloaded Episodes</h1>
              {downloadedEpisodes.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-slate-500 mt-20">
                   <HardDrive size={64} className="mb-4 opacity-10" />
                   <p className="text-lg font-bold opacity-20">No downloads yet.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {downloadedEpisodes.map(e => (
                    <EpisodeItem 
                      key={e.id} 
                      episode={e} 
                      isCurrent={currentEpisode?.id === e.id} 
                      isPlaying={isPlaying} 
                      onPlay={playEpisode}
                      downloadStatus="downloaded"
                      onDownload={handleDownload}
                      onDeleteDownload={handleDeleteDownload}
                      onAddToQueue={addToQueue}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : searchResults.length > 0 ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {searchResults.map(p => (
                <div key={p.feedUrl} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 group hover:border-slate-700 transition-all">
                  <div className="relative overflow-hidden rounded-xl mb-4">
                    <img src={p.artworkUrl} className="w-full aspect-square shadow-lg bg-slate-800" alt="" />
                    <button onClick={() => handleSubscribe(p)} className="absolute bottom-2 right-2 bg-blue-600 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><Plus size={20}/></button>
                  </div>
                  <h3 className="font-bold truncate text-sm mb-1">{p.title}</h3>
                  <p className="text-[10px] text-slate-500 truncate">{p.author}</p>
                </div>
              ))}
            </div>
          ) : selectedPodcast ? (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-end space-x-8 mb-12">
                <img src={selectedPodcast.artworkUrl} className="w-48 h-48 rounded-2xl shadow-2xl bg-slate-800" alt="" />
                <div className="pb-2">
                  <h1 className="text-4xl font-black mb-2 tracking-tight">{selectedPodcast.title}</h1>
                  <p className="text-slate-400 font-bold">{selectedPodcast.author}</p>
                </div>
              </div>
              
              <div className="space-y-1">
                {isLoadingEpisodes && (
                  <div className="flex items-center justify-center py-12 text-blue-500">
                    <Loader2 className="animate-spin mr-2" />
                    <span className="font-bold text-sm">Fetching Episodes...</span>
                  </div>
                )}
                {episodes.map(e => {
                  const isDownloaded = downloadedEpisodes.some(d => d.id === e.id);
                  const isDownloading = downloadingIds.has(e.id);
                  const status = isDownloaded ? 'downloaded' : (isDownloading ? 'downloading' : 'none');

                  return (
                    <EpisodeItem 
                      key={e.id} 
                      episode={e} 
                      isCurrent={currentEpisode?.id === e.id} 
                      isPlaying={isPlaying} 
                      onPlay={playEpisode}
                      downloadStatus={status}
                      onDownload={handleDownload}
                      onDeleteDownload={handleDeleteDownload}
                      onAddToQueue={addToQueue}
                    />
                  );
                })}

                {episodes.length < allEpisodes.length && !isLoadingEpisodes && (
                  <div className="py-8 flex justify-center">
                    <button 
                      onClick={loadMoreEpisodes}
                      className="flex items-center space-x-2 px-8 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-2xl font-bold text-sm transition-all"
                    >
                      <ChevronDown size={18} />
                      <span>Load More ({allEpisodes.length - episodes.length} left)</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
               <Search size={64} className="mb-4 opacity-5" />
               <p className="text-lg font-bold opacity-20 text-center">Find something to listen to</p>
            </div>
          )}
        </div>
      </main>

      {currentEpisode && (
        <footer className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 p-6 z-50">
          {isQueueOpen && (
            <div className="absolute bottom-full right-6 mb-4 w-96 max-h-[70vh] bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-800/50">
                <div className="flex items-center space-x-2">
                  <List size={20} className="text-blue-500" />
                  <h3 className="font-bold">Play Queue</h3>
                  <span className="bg-blue-600 text-[10px] px-2 py-0.5 rounded-full">{state.queue.length}</span>
                </div>
                <button onClick={() => setIsQueueOpen(false)} className="p-2 hover:bg-slate-700 rounded-full transition-colors">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                {state.queue.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <List size={48} className="mx-auto mb-4 opacity-10" />
                    <p className="text-sm font-bold opacity-20">Queue is empty</p>
                  </div>
                ) : (
                  state.queue.map((e, i) => (
                    <div key={e.id} className="group bg-slate-800/40 p-3 rounded-xl border border-slate-800/50 flex items-center space-x-3">
                      <div className="text-[10px] font-mono font-black text-slate-600 w-4">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold truncate">{e.title}</div>
                        <div className="text-[10px] text-slate-500 truncate">{e.podcastId}</div>
                      </div>
                      <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => reorderQueue(e.id, 'up')} className="p-1 hover:text-blue-400"><ChevronUp size={14} /></button>
                        <button onClick={() => reorderQueue(e.id, 'down')} className="p-1 hover:text-blue-400"><ChevronDown size={14} /></button>
                        <button onClick={() => removeFromQueue(e.id)} className="p-1 hover:text-red-400 ml-1"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          <div className="max-w-screen-2xl mx-auto flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-2">
              <div className="flex items-center space-x-4 w-1/3 min-w-0">
                <img src={playingPodcast?.artworkUrl || currentEpisode.audioUrl} className="w-12 h-12 rounded shadow-lg bg-slate-800" alt="" />
                <div className="min-w-0">
                  <div className="font-bold truncate text-sm">{currentEpisode.title}</div>
                  <div className="text-[10px] text-blue-400 font-bold truncate uppercase tracking-wider">{playingPodcast?.title || 'Unknown Podcast'}</div>
                </div>
              </div>

              <div className="flex items-center justify-center space-x-10 w-1/3">
                <button onClick={() => skip(-15)} className="text-slate-500 hover:text-white transition-colors flex flex-col items-center">
                  <RotateCcw size={22} />
                  <span className="text-[8px] font-black mt-1">15s</span>
                </button>
                <button onClick={togglePlay} className="bg-white text-slate-900 w-14 h-14 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl">
                  {isPlaying ? <Pause fill="currentColor" size={28} /> : <Play fill="currentColor" size={28} className="ml-1" />}
                </button>
                <button onClick={() => skip(30)} className="text-slate-500 hover:text-white transition-colors flex flex-col items-center">
                  <RotateCw size={22} />
                  <span className="text-[8px] font-black mt-1">30s</span>
                </button>
              </div>

              <div className="w-1/3 flex justify-end items-center space-x-6 text-[10px] font-mono font-bold text-slate-500">
                <button 
                  onClick={() => setIsQueueOpen(!isQueueOpen)}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg transition-colors ${isQueueOpen ? 'bg-blue-600 text-white' : 'bg-slate-800 hover:bg-slate-700'}`}
                >
                  <List size={14} />
                  <span>Queue ({state.queue.length})</span>
                </button>
                <span className="bg-slate-800 px-2 py-1 rounded">{formatTime(currentTime)} / {formatTime(duration)}</span>
              </div>
            </div>

            <div className="w-full max-w-2xl px-4 flex items-center group">
              <input 
                type="range"
                min="0"
                max={duration || 0}
                step="0.1"
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all"
              />
            </div>
          </div>
        </footer>
      )}
      <audio 
        ref={audioRef} 
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onPlay={() => setIsPlaying(true)} 
        onPause={() => setIsPlaying(false)} 
        onEnded={handleEpisodeEnded}
        className="hidden" 
      />
    </div>
  );
}
