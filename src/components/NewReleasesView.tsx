import React from 'react';
import { Clock, RotateCw, Loader2, CheckCircle2 } from 'lucide-react';
import type { AppState, Episode } from '../types';
import EpisodeItem from './EpisodeItem';

interface NewReleasesViewProps {
  state: AppState;
  isRefreshingNewReleases: boolean;
  loadNewReleases: () => void;
  toggleHidePlayed: (contextId: string, hidden: boolean) => void;
  currentEpisode: Episode | null;
  isPlaying: boolean;
  playEpisode: (episode: Episode) => void;
  onShowDescription?: (episode: Episode) => void;
  downloadedEpisodes: Episode[];
  downloadingIds: Set<string>;
  handleDownload: (episode: Episode) => void;
  handleDeleteDownload: (id: string) => void;
  addToQueue: (episode: Episode, position: 'top' | 'bottom') => void;
  toggleEpisodePlayed: (id: string, played: boolean) => void;
}

const NewReleasesView: React.FC<NewReleasesViewProps> = ({
  state,
  isRefreshingNewReleases,
  loadNewReleases,
  toggleHidePlayed,
  currentEpisode,
  isPlaying,
  playEpisode,
  onShowDescription,
  downloadedEpisodes,
  downloadingIds,
  handleDownload,
  handleDeleteDownload,
  addToQueue,
  toggleEpisodePlayed
}) => {
  const filteredReleases = state.newReleases.filter(e => 
    !(state.hidePlayedEpisodes['new-releases'] ?? true) || !state.playedEpisodes[e.id]
  );

  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-black mb-1">New Releases</h1>
          {state.lastRefresh && (
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
              Last updated: {new Date(state.lastRefresh).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2 text-sm text-slate-400 cursor-pointer hover:text-white transition-colors">
            <input 
              type="checkbox" 
              className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-600 focus:ring-offset-slate-900"
              checked={state.hidePlayedEpisodes['new-releases'] ?? true}
              onChange={(e) => toggleHidePlayed('new-releases', e.target.checked)}
            />
            <span>Hide Played</span>
          </label>
          <button 
            onClick={loadNewReleases}
            disabled={isRefreshingNewReleases}
            className={`p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white ${isRefreshingNewReleases ? 'opacity-50 cursor-not-allowed' : ''}`}
            title="Refresh New Releases"
          >
            <RotateCw size={20} className={isRefreshingNewReleases ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      
      {isRefreshingNewReleases && state.newReleases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-blue-500 space-y-4">
          <Loader2 size={32} className="animate-spin" />
          <span className="font-bold">Fetching latest episodes...</span>
        </div>
      ) : state.newReleases.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-slate-500 mt-20">
           <Clock size={64} className="mb-4 opacity-10" />
           <p className="text-lg font-bold opacity-20">No new releases found.</p>
           <p className="text-sm opacity-20 mt-2">Subscribe to some podcasts to see new episodes here.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {isRefreshingNewReleases && (
            <div className="flex items-center justify-center py-2 text-blue-500 bg-blue-500/10 rounded-lg mb-4 animate-pulse">
              <Loader2 size={14} className="animate-spin mr-2" />
              <span className="text-[10px] font-bold uppercase">Refreshing in background...</span>
            </div>
          )}
          {filteredReleases.length === 0 && !isRefreshingNewReleases ? (
            <div className="flex flex-col items-center justify-center text-slate-500 mt-20">
              <CheckCircle2 size={64} className="mb-4 opacity-10" />
              <p className="text-lg font-bold opacity-20">You're all caught up!</p>
            </div>
          ) : filteredReleases.map(e => {
            const podcast = state.subscriptions.find(s => s.feedUrl === e.podcastId);
            const isDownloaded = downloadedEpisodes.some(d => d.id === e.id);
            const isDownloading = downloadingIds.has(e.id);
            const status = isDownloaded ? 'downloaded' : (isDownloading ? 'downloading' : 'none');
            return (
              <EpisodeItem
                key={`${e.podcastId}-${e.id}`}
                episode={e} 
                isCurrent={currentEpisode?.id === e.id} 
                isPlaying={isPlaying} 
                onPlay={playEpisode}
                onShowDescription={onShowDescription}
                downloadStatus={status}
                onDownload={handleDownload}
                onDeleteDownload={handleDeleteDownload}
                onAddToQueue={addToQueue}
                artworkUrl={podcast?.artworkUrl}
                isPlayed={state.playedEpisodes[e.id]}
                onTogglePlayed={toggleEpisodePlayed}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default NewReleasesView;
