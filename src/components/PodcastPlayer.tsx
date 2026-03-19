import React, { useState } from 'react';
import { 
  RotateCcw, RotateCw, Pause, Play, List, X, 
  ChevronUp, ChevronDown, Trash2, Podcast as PodcastIcon 
} from 'lucide-react';
import type { Episode, Podcast, AppState } from '../types';

interface PodcastPlayerProps {
  state: AppState;
  currentEpisode: Episode;
  playingPodcast: Podcast | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  togglePlay: () => void;
  skip: (seconds: number) => void;
  handleSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  formatTime: (time: number) => string;
  reorderQueue: (id: string, direction: 'up' | 'down') => void;
  removeFromQueue: (id: string) => void;
}

const PodcastPlayer: React.FC<PodcastPlayerProps> = ({
  state,
  currentEpisode,
  playingPodcast,
  isPlaying,
  currentTime,
  duration,
  togglePlay,
  skip,
  handleSeek,
  formatTime,
  reorderQueue,
  removeFromQueue
}) => {
  const [isQueueOpen, setIsQueueOpen] = useState(false);

  return (
    <footer className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 p-6 z-50">
      {isQueueOpen && (
        <div className="absolute bottom-full right-6 mb-4 w-96 max-h-[70vh] bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl z-50 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
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
              state.queue.map((e, i) => {
                const podcast = state.subscriptions.find(s => s.feedUrl === e.podcastId);
                return (
                  <div key={e.id} className="group bg-slate-800/40 p-3 rounded-xl border border-slate-800/50 flex items-center space-x-3">
                    <div className="text-[10px] font-mono font-black text-slate-600 w-4">{i + 1}</div>
                    {podcast?.artworkUrl ? (
                      <img src={podcast.artworkUrl} className="w-8 h-8 rounded shadow-lg bg-slate-800 flex-shrink-0 object-cover" alt="" />
                    ) : (
                      <div className="w-8 h-8 rounded shadow-lg bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-600">
                        <PodcastIcon size={16} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold truncate">{e.title}</div>
                      <div className="text-[10px] text-slate-500 truncate">{podcast?.title || e.podcastId}</div>
                    </div>
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => reorderQueue(e.id, 'up')} className="p-1 hover:text-blue-400"><ChevronUp size={14} /></button>
                      <button onClick={() => reorderQueue(e.id, 'down')} className="p-1 hover:text-blue-400"><ChevronDown size={14} /></button>
                      <button onClick={() => removeFromQueue(e.id)} className="p-1 hover:text-red-400 ml-1"><Trash2 size={14} /></button>
                    </div>
                  </div>
                );
              })
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
  );
};

export default PodcastPlayer;
