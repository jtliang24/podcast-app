import React from 'react';
import { Loader2, ChevronDown, CheckCircle2 } from 'lucide-react';
import type { AppState, Episode, Podcast, SortOrder, QueueEpisode } from '../types';
import EpisodeItem from './EpisodeItem';

interface PodcastViewProps {
  state: AppState;
  selectedPodcast: Podcast;
  isLoadingEpisodes: boolean;
  episodes: Episode[];
  allEpisodes: Episode[];
  currentEpisode: Episode | null;
  isPlaying: boolean;
  playEpisode: (episode: Episode) => void;
  onShowDescription?: (episode: Episode) => void;
  downloadedEpisodes: Episode[];
  downloadingIds: Set<string>;
  handleDownload: (episode: Episode) => void;
  handleDeleteDownload: (id: string) => void;
  addToQueue: QueueEpisode;
  toggleEpisodePlayed: (id: string, played: boolean) => void;
  handleMarkOlderAsPlayed: (episode: Episode) => void;
  toggleHidePlayed: (contextId: string, hidden: boolean) => void;
  handleSortChange: (order: SortOrder) => void;
  loadMoreEpisodes: () => void;
}

const PodcastView: React.FC<PodcastViewProps> = ({
  state,
  selectedPodcast,
  isLoadingEpisodes,
  episodes,
  allEpisodes,
  currentEpisode,
  isPlaying,
  playEpisode,
  onShowDescription,
  downloadedEpisodes,
  downloadingIds,
  handleDownload,
  handleDeleteDownload,
  addToQueue,
  toggleEpisodePlayed,
  handleMarkOlderAsPlayed,
  toggleHidePlayed,
  handleSortChange,
  loadMoreEpisodes
}) => {
  const filteredEpisodes = episodes.filter(e => 
    !(state.hidePlayedEpisodes[selectedPodcast.feedUrl] ?? true) || !state.playedEpisodes[e.id]
  );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-12 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
        <div className="flex min-w-0 items-start gap-4 sm:items-end sm:gap-8">
          <img src={selectedPodcast.artworkUrl} className="h-20 w-20 shrink-0 rounded-2xl shadow-2xl bg-slate-800 sm:h-32 sm:w-32 xl:h-48 xl:w-48" alt="" />
          <div className="min-w-0 pb-2 [overflow-wrap:anywhere]">
            <h1 className="text-2xl font-black mb-2 tracking-tight sm:text-4xl">{selectedPodcast.title}</h1>
            <p className="text-slate-400 font-bold">{selectedPodcast.author}</p>
          </div>
        </div>
        
        <div className="flex shrink-0 flex-wrap items-center gap-3 pb-2 lg:max-w-[45%]">
          <label className="flex items-center space-x-2 text-sm text-slate-400 cursor-pointer hover:text-white transition-colors">
            <input 
              type="checkbox" 
              className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-600 focus:ring-offset-slate-900"
              checked={state.hidePlayedEpisodes[selectedPodcast.feedUrl] ?? true}
              onChange={(e) => toggleHidePlayed(selectedPodcast.feedUrl, e.target.checked)}
            />
            <span>Hide Played</span>
          </label>
          <select 
            aria-label="Sort episodes"
            value={state.podcastSortOrders[selectedPodcast.feedUrl] || 'newest'} 
            onChange={(e) => handleSortChange(e.target.value as SortOrder)}
            className="block min-w-0 max-w-full bg-slate-900 border border-slate-800 text-slate-300 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2.5 outline-none cursor-pointer hover:bg-slate-800 transition-colors"
          >
            <option value="newest">Newest to Oldest</option>
            <option value="oldest">Oldest to Newest</option>
            <option value="a-z">A to Z</option>
            <option value="z-a">Z to A</option>
            <option value="longest">Longest First</option>
            <option value="shortest">Shortest First</option>
          </select>
        </div>
      </div>
      
      <div className="space-y-1">
        {isLoadingEpisodes && (
          <div className="flex items-center justify-center py-12 text-blue-500">
            <Loader2 className="animate-spin mr-2" />
            <span className="font-bold text-sm">Fetching Episodes...</span>
          </div>
        )}
        
        {filteredEpisodes.length === 0 && !isLoadingEpisodes ? (
          <div className="flex flex-col items-center justify-center text-slate-500 mt-20">
            <CheckCircle2 size={64} className="mb-4 opacity-10" />
            <p className="text-lg font-bold opacity-20">You're all caught up!</p>
          </div>
        ) : (
          filteredEpisodes.map(e => {
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
                onShowDescription={onShowDescription}
                downloadStatus={status}
                onDownload={handleDownload}
                onDeleteDownload={handleDeleteDownload}
                onAddToQueue={addToQueue}
                artworkUrl={selectedPodcast.artworkUrl}
                isPlayed={state.playedEpisodes[e.id]}
                onTogglePlayed={toggleEpisodePlayed}
                onMarkOlderAsPlayed={handleMarkOlderAsPlayed}
              />
            );
          })
        )}

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
  );
};

export default PodcastView;
