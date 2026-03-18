import React, { useState, useEffect, useRef } from 'react';
import { useFileSystem } from './hooks/useFileSystem';
import { fetchPodcastFeed, searchPodcasts, parseOPML, generateOPML } from './services/podcastService';
import type { Podcast, Episode, PlaybackProgress } from './types';
import { Search, Plus, Play, Pause, FolderOpen, Download, Upload, Trash2, AlertCircle } from 'lucide-react';

export default function App() {
  const isSupported = 'showOpenFilePicker' in window;
  const { state, fileHandle, selectFile, createNewFile, updateState } = useFileSystem();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Podcast[]>([]);
  const [selectedPodcast, setSelectedPodcast] = useState<Podcast | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      if (audioRef.current && currentEpisode && isPlaying) {
        saveProgress(currentEpisode.audioUrl, audioRef.current.currentTime, audioRef.current.duration);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [currentEpisode, isPlaying]);

  const saveProgress = (episodeUrl: string, currentTime: number, duration: number) => {
    if (!fileHandle) return;
    const progress: PlaybackProgress = { episodeUrl, currentTime, duration, lastUpdated: Date.now() };
    updateState({ ...state, playbackProgress: { ...state.playbackProgress, [episodeUrl]: progress } });
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;
    const results = await searchPodcasts(searchQuery);
    setSearchResults(results);
  };

  const handleSubscribe = async (podcast: Podcast) => {
    if (state.subscriptions.find(s => s.feedUrl === podcast.feedUrl)) return;
    updateState({ ...state, subscriptions: [...state.subscriptions, podcast] });
    setSearchResults([]);
    setSearchQuery('');
  };

  const selectPodcast = async (podcast: Podcast) => {
    setSelectedPodcast(podcast);
    try {
      const { episodes } = await fetchPodcastFeed(podcast.feedUrl);
      setEpisodes(episodes);
    } catch (e) { console.error(e); }
  };

  const playEpisode = (episode: Episode) => {
    setCurrentEpisode(episode);
    setIsPlaying(true);
    if (audioRef.current) {
      const savedProgress = state.playbackProgress[episode.audioUrl];
      audioRef.current.src = episode.audioUrl;
      if (savedProgress) audioRef.current.currentTime = savedProgress.currentTime;
      audioRef.current.play().catch(console.error);
    }
  };

  if (!isSupported) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white">
        <AlertCircle size={48} className="text-red-500 mb-4" />
        <h1 className="text-2xl font-bold">Browser Not Supported</h1>
        <p className="text-slate-400 mt-2">Please use a Chromium-based browser (Chrome, Edge, etc.) for local file features.</p>
      </div>
    );
  }

  if (!fileHandle) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white">
        <h1 className="text-5xl font-black mb-12 bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          Podcast Player
        </h1>
        <div className="bg-slate-800 p-10 rounded-3xl border border-slate-700 shadow-2xl flex flex-col space-y-6 max-w-sm w-full">
          <button onClick={selectFile} className="bg-blue-600 hover:bg-blue-700 p-5 rounded-2xl flex items-center justify-center font-bold text-lg">
            <FolderOpen className="mr-3" /> Open File
          </button>
          <button onClick={createNewFile} className="bg-slate-700 hover:bg-slate-600 p-5 rounded-2xl flex items-center justify-center font-bold text-lg">
            <Plus className="mr-3" /> New File
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex">
      <aside className="w-64 border-r border-slate-800 flex flex-col">
        <div className="p-6 border-b border-slate-800 font-bold">Subscriptions</div>
        <div className="flex-1 overflow-y-auto">
          {state.subscriptions.map(p => (
            <button key={p.feedUrl} onClick={() => selectPodcast(p)} className="w-full text-left p-4 hover:bg-slate-800 flex items-center space-x-3">
              <img src={p.artworkUrl} className="w-10 h-10 rounded shadow-lg" alt="" />
              <div className="truncate text-sm font-medium">{p.title}</div>
            </button>
          ))}
        </div>
      </aside>

      <main className="flex-1 flex flex-col pb-28 overflow-hidden">
        <header className="p-6 flex items-center justify-center">
          <form onSubmit={handleSearch} className="relative w-full max-w-lg">
            <Search className="absolute left-4 top-3.5 text-slate-500" size={18} />
            <input 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-3 pl-12 pr-4 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search podcasts..."
            />
          </form>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {searchResults.length > 0 ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              {searchResults.map(p => (
                <div key={p.feedUrl} className="bg-slate-800 p-4 rounded-2xl border border-slate-700 group hover:scale-105 transition-all">
                  <img src={p.artworkUrl} className="w-full aspect-square rounded-xl shadow-lg mb-4" alt="" />
                  <h3 className="font-bold truncate text-sm mb-1">{p.title}</h3>
                  <button onClick={() => handleSubscribe(p)} className="w-full mt-4 bg-blue-600 hover:bg-blue-700 py-2 rounded-xl text-sm font-bold">Subscribe</button>
                </div>
              ))}
            </div>
          ) : selectedPodcast ? (
            <div>
              <div className="flex items-end space-x-6 mb-12">
                <img src={selectedPodcast.artworkUrl} className="w-48 h-48 rounded-2xl shadow-2xl" alt="" />
                <h1 className="text-4xl font-black mb-2">{selectedPodcast.title}</h1>
              </div>
              <div className="space-y-2">
                {episodes.map(e => (
                  <button key={e.id} onClick={() => playEpisode(e)} className="w-full text-left p-4 rounded-xl hover:bg-white/5 flex items-center justify-between group">
                    <span className="font-bold text-sm truncate">{e.title}</span>
                    <Play className="opacity-0 group-hover:opacity-100 transition-all text-blue-500" fill="currentColor" size={20} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
               <Search size={64} className="mb-4 opacity-10" />
               <p className="text-xl font-bold">Find a podcast to start listening</p>
            </div>
          )}
        </div>
      </main>

      {currentEpisode && (
        <footer className="fixed bottom-0 left-0 right-0 bg-slate-800/90 backdrop-blur-xl border-t border-slate-700 p-6 flex items-center justify-between">
          <div className="flex items-center space-x-4 w-1/3">
            <img src={selectedPodcast?.artworkUrl} className="w-12 h-12 rounded shadow-lg" alt="" />
            <div className="min-w-0">
              <div className="font-bold truncate text-sm">{currentEpisode.title}</div>
              <div className="text-xs text-blue-400 font-bold">{selectedPodcast?.title}</div>
            </div>
          </div>
          <button onClick={() => { if (audioRef.current) { if (isPlaying) audioRef.current.pause(); else audioRef.current.play(); setIsPlaying(!isPlaying); } }} className="bg-white text-slate-900 w-12 h-12 rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-all">
            {isPlaying ? <Pause fill="currentColor" size={24} /> : <Play fill="currentColor" size={24} className="ml-1" />}
          </button>
          <div className="w-1/3" />
          <audio ref={audioRef} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} className="hidden" />
        </footer>
      )}
    </div>
  );
}
