import React, { useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { 
  Play, Pause, ArrowLeft,
  ArrowDownToLine, Loader2, CheckCircle2, Clock, Calendar, FileText
} from 'lucide-react';
import type { Episode, Podcast, QueueEpisode } from '../types';
import EpisodeQueueActions from './EpisodeQueueActions';
import TranscriptPanel from './TranscriptPanel';
import { useTranscript } from '../hooks/useTranscript';
import { formatTime } from '../hooks/usePodcastPlayer';
import { pickTranscript } from '../services/transcripts';

interface EpisodeDescriptionViewProps {
  episode: Episode;
  podcast: Podcast | undefined;
  onBack: () => void;
  onPlay: (e: Episode) => void;
  isCurrent: boolean;
  isPlaying: boolean;
  onAddToQueue: QueueEpisode;
  onDownload: (e: Episode) => void;
  onDeleteDownload: (id: string) => void;
  downloadStatus: 'none' | 'downloading' | 'downloaded';
}

/** The transcript of an episode that isn't playing, as text to read (Now Playing shows the playing one in sync). */
function EpisodeTranscript({ episode }: { episode: Episode }) {
  const transcript = useTranscript(episode);
  if (transcript.status === 'none') return <p className="text-sm text-slate-400">No transcript is available.</p>;
  return <TranscriptPanel transcript={transcript} formatTime={formatTime} className="h-[70dvh]" />;
}

const EpisodeDescriptionView: React.FC<EpisodeDescriptionViewProps> = ({
  episode,
  podcast,
  onBack,
  onPlay,
  isCurrent,
  isPlaying,
  onAddToQueue,
  onDownload,
  onDeleteDownload,
  downloadStatus
}) => {
  const description = useMemo(() => DOMPurify.sanitize(episode.description, {
    ALLOWED_TAGS: ['p', 'br', 'div', 'span', 'a', 'img', 'b', 'strong', 'i', 'em', 'u', 's', 'hr',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title'],
  }), [episode.description]);
  // Which episode's transcript is open, so it closes when another episode is shown.
  const [transcriptFor, setTranscriptFor] = useState<string | null>(null);
  const hasTranscript = !isCurrent && !!pickTranscript(episode.transcripts, navigator.language);
  const showTranscript = hasTranscript && transcriptFor === episode.id;
  const dateStr = new Date(episode.pubDate).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  return (
    <div className="max-w-4xl mx-auto pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button 
        onClick={onBack}
        className="flex items-center space-x-2 text-slate-400 hover:text-white mb-8 transition-colors group"
      >
        <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
        <span className="font-bold">Back</span>
      </button>

      <div className="flex flex-col md:flex-row gap-8 mb-12">
        <div className="w-full md:w-64 flex-shrink-0">
          <img 
            src={podcast?.artworkUrl || episode.audioUrl} 
            className="w-full aspect-square rounded-2xl shadow-2xl bg-slate-800 object-cover" 
            alt={episode.title} 
          />
        </div>
        
        <div className="flex-1 flex flex-col justify-end">
          <div className="text-blue-400 font-bold uppercase tracking-widest text-xs mb-2">
            {podcast?.title || 'Unknown Podcast'}
          </div>
          <h1 className="text-3xl md:text-5xl font-black mb-6 leading-tight">
            {episode.title}
          </h1>
          
          <div className="flex flex-wrap items-center gap-6 text-slate-400 text-sm font-bold">
            <div className="flex items-center">
              <Calendar size={16} className="mr-2" />
              {dateStr}
            </div>
            <div className="flex items-center">
              <Clock size={16} className="mr-2" />
              {formatDuration(episode.duration)}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-12">
        <button 
          onClick={() => onPlay(episode)}
          className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-2xl font-black flex items-center shadow-xl hover:scale-105 active:scale-95 transition-all"
        >
          {isCurrent && isPlaying ? (
            <>
              <Pause size={20} fill="currentColor" className="mr-3" />
              Pause
            </>
          ) : (
            <>
              <Play size={20} fill="currentColor" className="mr-3 ml-1" />
              {isCurrent ? 'Resume' : 'Play Episode'}
            </>
          )}
        </button>

        {!isCurrent && <EpisodeQueueActions
          onAction={action => onAddToQueue(episode, action)}
          className="flex items-center rounded-2xl bg-slate-800 px-5 py-4 font-bold text-white transition-colors hover:bg-slate-700"
        />}

        {downloadStatus === 'none' && (
          <button 
            onClick={() => onDownload(episode)}
            className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-4 rounded-2xl font-bold flex items-center transition-all"
          >
            <ArrowDownToLine size={20} className="mr-2" />
            Download
          </button>
        )}
        {downloadStatus === 'downloading' && (
          <div className="bg-slate-800/50 text-blue-500 px-6 py-4 rounded-2xl font-bold flex items-center">
            <Loader2 size={20} className="mr-2 animate-spin" />
            Downloading...
          </div>
        )}
        {downloadStatus === 'downloaded' && (
          <button 
            onClick={() => onDeleteDownload(episode.id)}
            className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-6 py-4 rounded-2xl font-bold flex items-center hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20 transition-all group"
          >
            <CheckCircle2 size={20} className="mr-2 group-hover:hidden" />
            <span className="group-hover:hidden">Downloaded</span>
            <span className="hidden group-hover:inline">Delete Download</span>
          </button>
        )}

        {hasTranscript && (
          <button
            type="button"
            aria-expanded={showTranscript}
            aria-controls="episode-transcript"
            onClick={() => setTranscriptFor(showTranscript ? null : episode.id)}
            className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-4 rounded-2xl font-bold flex items-center transition-all"
          >
            <FileText size={20} className="mr-2" aria-hidden="true" />
            {showTranscript ? 'Hide transcript' : 'Read transcript'}
          </button>
        )}
      </div>

      {showTranscript && (
        <section id="episode-transcript" aria-labelledby="episode-transcript-heading" className="mb-12">
          <h2 id="episode-transcript-heading" className="text-xl font-bold mb-4 text-slate-200">Transcript</h2>
          <EpisodeTranscript episode={episode} />
        </section>
      )}

      <div className="prose prose-invert max-w-none">
        <h2 className="text-xl font-bold mb-4 text-slate-200">About this episode</h2>
        
        {episode.keywords && episode.keywords.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            {episode.keywords.map(tag => (
              <span key={tag} className="px-3 py-1 bg-slate-800 border border-slate-700 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-400">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div 
          className="text-slate-400 leading-relaxed space-y-4 episode-description"
          dangerouslySetInnerHTML={{ __html: description }}
        />
      </div>
    </div>
  );
};

export default EpisodeDescriptionView;
