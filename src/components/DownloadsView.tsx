import React from 'react';
import { HardDrive } from 'lucide-react';
import type { AppState, Episode } from '../types';
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
  addToQueue: (episode: Episode, position: 'top' | 'bottom') => void;
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
  addToQueue,
  toggleEpisodePlayed
}) => {
  return (
    <div className="animate-in fade-in duration-500">
      <h1 className="text-3xl font-black mb-8">Downloaded Episodes</h1>
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
