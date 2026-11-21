import React, { useRef, useState } from 'react';
import { 
  RotateCcw, RotateCw, Pause, Play, List, X, 
  ChevronUp, ChevronDown, Maximize2, Trash2, Podcast as PodcastIcon
} from 'lucide-react';
import type { Episode, Podcast, AppState, SkipInterval } from '../types';
import NowPlayingScreen from './NowPlayingScreen';

interface PodcastPlayerProps {
  state: AppState;
  currentEpisode: Episode | null;
  playingPodcast: Podcast | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  togglePlay: () => void;
  playEpisode: (episode: Episode) => void;
  skip: (seconds: number) => void;
  skipBackwardSeconds: SkipInterval;
  skipForwardSeconds: SkipInterval;
  seek: (time: number) => void;
  formatTime: (time: number) => string;
  playbackError: boolean;
  retry: () => void;
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
  playEpisode,
  skip,
  skipBackwardSeconds,
  skipForwardSeconds,
  seek,
  formatTime,
  playbackError,
  retry,
  reorderQueue,
  removeFromQueue
}) => {
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const nowPlayingRef = useRef<HTMLDialogElement>(null);

  return (
    <footer className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 p-3 md:p-6 z-50">
      {playbackError && (
        <div role="alert" className="mb-2 text-center text-sm text-red-300">
          Couldn’t play this episode. <button className="ml-2 font-bold underline" onClick={retry}>Retry playback</button>
        </div>
      )}
      {isQueueOpen && (
        <div className="absolute bottom-full right-2 mb-4 w-[min(24rem,95vw)] max-h-[70vh] bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl z-50 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
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
                const isItemCurrent = currentEpisode?.id === e.id;
                return (
                  <div key={e.id} className={`group p-3 rounded-xl border flex items-center space-x-3 transition-colors ${
                    isItemCurrent 
                      ? 'bg-blue-600/20 border-blue-500/50' 
                      : 'bg-slate-800/40 border-slate-800/50'
                  }`}>
                    <div className={`text-[10px] font-mono font-black w-4 ${isItemCurrent ? 'text-blue-400' : 'text-slate-600'}`}>{i + 1}</div>
                    {podcast?.artworkUrl ? (
                      <img src={podcast.artworkUrl} className="w-8 h-8 rounded shadow-lg bg-slate-800 flex-shrink-0 object-cover" alt="" />
                    ) : (
                      <div className="w-8 h-8 rounded shadow-lg bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-600">
                        <PodcastIcon size={16} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-bold truncate ${isItemCurrent ? 'text-blue-400' : ''}`}>{e.title}</div>
                      <div className="text-[10px] text-slate-500 truncate">{podcast?.title || e.podcastId}</div>
                    </div>
                    {!isItemCurrent && (
                      <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => playEpisode(e)} className="p-1 hover:text-blue-400" title="Play Now"><Play size={14} fill="currentColor" /></button>
                        <button onClick={() => reorderQueue(e.id, 'up')} className="p-1 hover:text-blue-400"><ChevronUp size={14} /></button>
                        <button onClick={() => reorderQueue(e.id, 'down')} className="p-1 hover:text-blue-400"><ChevronDown size={14} /></button>
                        <button onClick={() => removeFromQueue(e.id)} className="p-1 hover:text-red-400 ml-1"><Trash2 size={14} /></button>
                      </div>
                    )}
                    {isItemCurrent && (
                      <div className="flex items-center space-x-1 text-blue-500">
                        {isPlaying ? <div className="animate-pulse"><Play size={14} fill="currentColor" /></div> : <Pause size={14} fill="currentColor" />}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
      <div className="max-w-screen-2xl mx-auto flex flex-col items-center">
        <div className="w-full flex flex-wrap items-center justify-between gap-y-2 mb-2">
          <button
            type="button"
            aria-label={currentEpisode ? `Open Now Playing: ${currentEpisode.title}` : undefined}
            aria-haspopup="dialog"
            aria-controls="now-playing"
            onClick={event => {
              event.currentTarget.focus();
              nowPlayingRef.current?.showModal();
            }}
            disabled={!currentEpisode}
            className="flex w-full min-w-0 items-center gap-3 rounded-lg text-left enabled:hover:bg-slate-800 md:w-1/3"
          >
            {playingPodcast?.artworkUrl ? (
              <img src={playingPodcast.artworkUrl} className="h-12 w-12 shrink-0 rounded bg-slate-800 shadow-lg" alt="" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-slate-800 text-slate-600 shadow-lg">
                <PodcastIcon size={24} />
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{currentEpisode?.title || 'No episode selected'}</span>
              <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-blue-400">{playingPodcast?.title || (currentEpisode ? 'Unknown Podcast' : 'Ready to listen')}</span>
            </span>
            {currentEpisode && <Maximize2 size={18} className="ml-auto mr-3 shrink-0 text-blue-400" aria-hidden="true" />}
          </button>

          <div className="flex items-center justify-center space-x-4 md:space-x-10 md:w-1/3">
            <button 
              aria-label={`Back ${skipBackwardSeconds} seconds`}
              onClick={() => skip(-skipBackwardSeconds)}
              disabled={!currentEpisode}
              className="text-slate-500 hover:text-white disabled:opacity-30 disabled:hover:text-slate-500 transition-colors flex flex-col items-center"
            >
              <RotateCcw size={22} />
              <span className="text-[8px] font-black mt-1">{skipBackwardSeconds}s</span>
            </button>
            <button 
              aria-label={isPlaying ? 'Pause' : 'Play'}
              onClick={togglePlay} 
              disabled={!currentEpisode}
              className="bg-white text-slate-900 w-14 h-14 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100 transition-all shadow-xl"
            >
              {isPlaying ? <Pause fill="currentColor" size={28} /> : <Play fill="currentColor" size={28} className="ml-1" />}
            </button>
            <button 
              aria-label={`Forward ${skipForwardSeconds} seconds`}
              onClick={() => skip(skipForwardSeconds)}
              disabled={!currentEpisode}
              className="text-slate-500 hover:text-white disabled:opacity-30 disabled:hover:text-slate-500 transition-colors flex flex-col items-center"
            >
              <RotateCw size={22} />
              <span className="text-[8px] font-black mt-1">{skipForwardSeconds}s</span>
            </button>
          </div>

          <div className="md:w-1/3 flex justify-end items-center space-x-2 md:space-x-6 text-[10px] font-mono font-bold text-slate-500">
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
            aria-label="Playback position"
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={currentTime}
            onChange={event => seek(event.currentTarget.valueAsNumber)}
            disabled={!currentEpisode}
            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 disabled:opacity-30 disabled:cursor-default transition-all"
          />
        </div>
      </div>
      <NowPlayingScreen
        ref={nowPlayingRef}
        episode={currentEpisode}
        podcast={playingPodcast}
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
    </footer>
  );
};

export default PodcastPlayer;
