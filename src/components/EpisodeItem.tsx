import React, { useMemo, useState } from 'react';
import { 
  Play, Pause, CheckCircle2, 
  MoreVertical, Check, History,
  ArrowDownToLine, Loader2, Podcast as PodcastIcon 
} from 'lucide-react';
import type { Episode, QueueEpisode } from '../types';
import EpisodeQueueActions from './EpisodeQueueActions';

interface EpisodeItemProps {
  episode: Episode;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: (e: Episode) => void;
  onShowDescription?: (e: Episode) => void;
  downloadStatus: 'none' | 'downloading' | 'downloaded';
  onDownload: (e: Episode) => void;
  onDeleteDownload: (id: string) => void;
  onAddToQueue: QueueEpisode;
  artworkUrl?: string;
  isPlayed?: boolean;
  onTogglePlayed?: (id: string, played: boolean) => void;
  onMarkOlderAsPlayed?: (e: Episode) => void;
}

const EpisodeItem = React.memo(({
  episode,
  isCurrent,
  isPlaying,
  onPlay,
  onShowDescription,
  downloadStatus,
  onDownload,
  onDeleteDownload,
  onAddToQueue,
  artworkUrl,
  isPlayed,
  onTogglePlayed,
  onMarkOlderAsPlayed
}: EpisodeItemProps) => {
  const dateStr = useMemo(() => {
    try {
      return new Date(episode.pubDate).toLocaleDateString();
    } catch {
      return 'Unknown date';
    }
  }, [episode.pubDate]);
  
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className={`w-full p-4 rounded-xl hover:bg-white/5 flex items-center justify-between group transition-colors ${isCurrent ? 'bg-blue-500/10' : ''} ${isPlayed ? 'opacity-50' : ''}`}>
      <div className="flex items-center flex-1 min-w-0 mr-4">
        {artworkUrl ? (
          <img
            src={artworkUrl}
            className="w-10 h-10 rounded shadow-lg mr-4 bg-slate-800 flex-shrink-0 object-cover"
            alt=""
          />
        ) : (
          <div className="w-10 h-10 rounded shadow-lg mr-4 bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-500">
            <PodcastIcon size={20} />
          </div>
        )}
        <button onClick={() => onShowDescription ? onShowDescription(episode) : onPlay(episode)} className="flex-1 text-left min-w-0 cursor-pointer flex items-center">
          <div className="min-w-0 flex-1">
            <div className={`font-bold text-sm truncate group-hover:underline ${isCurrent ? 'text-blue-400' : 'text-slate-200'}`}>{episode.title}</div>
            <div className="text-[10px] text-slate-500 mt-1">{dateStr}</div>
          </div>
          {isPlayed && <Check size={16} className="ml-2 text-slate-500 flex-shrink-0" />}
        </button>
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setShowMenu(false);
        }} onKeyDown={event => {
          if (event.key === 'Escape' && showMenu) {
            event.currentTarget.querySelector('button')?.focus();
            setShowMenu(false);
          }
        }}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            aria-label={`More actions for ${episode.title}`}
            aria-expanded={showMenu}
            className="p-2 rounded-full text-slate-400 hover:text-white bg-slate-800 transition-all"
          >
            <MoreVertical size={16} />
          </button>
          {showMenu && (
            <div className="absolute right-0 bottom-full mb-2 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
              {!isCurrent && <EpisodeQueueActions
                onAction={action => {
                  onAddToQueue(episode, action);
                  setShowMenu(false);
                }}
                className="flex w-full items-center px-4 py-3 text-left text-xs font-bold hover:bg-slate-700 focus-visible:bg-slate-700"
              />}
              {onTogglePlayed && (
                <button
                  onClick={() => onTogglePlayed(episode.id, !isPlayed)}
                  className="w-full text-left px-4 py-3 text-xs font-bold hover:bg-slate-700 border-t border-slate-700 transition-colors flex items-center"
                >
                  <Check size={14} className="mr-2" /> Mark as {isPlayed ? 'Unplayed' : 'Played'}
                </button>
              )}
              {onMarkOlderAsPlayed && (
                <button
                  onClick={() => onMarkOlderAsPlayed(episode)}
                  className="w-full text-left px-4 py-3 text-xs font-bold hover:bg-slate-700 border-t border-slate-700 transition-colors flex items-center"
                >
                  <History size={14} className="mr-2" /> Mark Older as Played
                </button>
              )}
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

export default EpisodeItem;
