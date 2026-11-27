import React from 'react';
import { HardDrive, Trash2 } from 'lucide-react';
import type { AppState, Episode, QueueEpisode } from '../types';
import EpisodeItem from './EpisodeItem';

interface DownloadsViewProps {
  state: AppState;
  downloadedEpisodes: Episode[];
  currentEpisode: Episode | null;
  isPlaying: boolean;
  playEpisode: (episode: Episode) => void;
  onShowDescription?: (episode: Episode) => void;
  handleDownload: (episode: Episode) => void;
  handleDeleteDownload: (id: string) => void;
  onRemoveFinishedDownloads: (ids: string[]) => void;
  isRemovingFinishedDownloads: boolean;
  addToQueue: QueueEpisode;
  toggleEpisodePlayed: (id: string, played: boolean) => void;
}

const DownloadsView: React.FC<DownloadsViewProps> = ({
  state,
  downloadedEpisodes,
  currentEpisode,
  isPlaying,
  playEpisode,
  onShowDescription,
  handleDownload,
  handleDeleteDownload,
  onRemoveFinishedDownloads,
  isRemovingFinishedDownloads,
  addToQueue,
  toggleEpisodePlayed
}) => {
  const finishedDownloadIds = downloadedEpisodes.filter(episode => state.playedEpisodes[episode.id]).map(episode => episode.id);

  return (
    <div className="animate-in fade-in duration-500">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-black">Downloaded Episodes</h1>
        <button
          type="button"
          className="flex min-h-11 items-center gap-2 rounded-lg border border-red-400/40 px-3 py-2 text-left text-sm font-semibold text-red-300 enabled:hover:bg-red-500/10 disabled:opacity-40"
          disabled={isRemovingFinishedDownloads || finishedDownloadIds.length === 0}
          onClick={() => onRemoveFinishedDownloads(finishedDownloadIds)}
        >
          <Trash2 size={18} className="shrink-0" aria-hidden="true" />
          {isRemovingFinishedDownloads ? 'Removing finished downloads…' : 'Remove all finished downloads'}
        </button>
      </div>
      {downloadedEpisodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-slate-500 mt-20">
           <HardDrive size={64} className="mb-4 opacity-10" />
           <p className="text-lg font-bold opacity-20">No downloads yet.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {downloadedEpisodes.map(e => {
            const podcast = state.subscriptions.find(s => s.feedUrl === e.podcastId);
            return (
              <EpisodeItem 
                key={e.id} 
                episode={e} 
                isCurrent={currentEpisode?.id === e.id} 
                isPlaying={isPlaying} 
                onPlay={playEpisode}
                onShowDescription={onShowDescription}
                downloadStatus="downloaded"
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

export default DownloadsView;
