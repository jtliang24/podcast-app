import React from 'react';
import { Loader2, Plus } from 'lucide-react';
import type { Podcast } from '../types';

interface SearchResultsViewProps {
  searchResults?: Podcast[];
  subscriptions: Podcast[];
  selectPodcast: (podcast: Podcast) => void;
  handleSubscribe: (podcast: Podcast) => void;
}

const SearchResultsView: React.FC<SearchResultsViewProps> = ({
  searchResults,
  subscriptions,
  selectPodcast,
  handleSubscribe
}) => {
  if (!searchResults) {
    return <p role="status" className="flex items-center gap-2 text-slate-400"><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Searching podcasts…</p>;
  }
  if (searchResults.length === 0) return <p className="text-slate-400">No podcasts found.</p>;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
      {searchResults.map(p => (
        <div key={p.feedUrl} className="relative bg-slate-900 p-4 rounded-2xl border border-slate-800 hover:border-slate-700 transition-all">
          <button type="button" onClick={() => selectPodcast(p)} aria-label={`Open ${p.title}`} className="w-full min-w-0 rounded-xl text-left hover:text-blue-300">
            <img src={p.artworkUrl} className="mb-4 w-full aspect-square rounded-xl shadow-lg bg-slate-800" alt="" />
            <span className="block font-bold truncate text-sm mb-1">{p.title}</span>
            <span className="block truncate text-[10px] text-slate-500">{p.author}</span>
          </button>
          {!subscriptions.some(subscription => subscription.feedUrl === p.feedUrl) && (
            <button type="button"
              onClick={() => handleSubscribe(p)} aria-label={`Subscribe to ${p.title}`}
              className="absolute right-6 bottom-20 grid h-11 w-11 place-items-center rounded-full bg-blue-600 hover:bg-blue-500"
            >
              <Plus size={20} aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default SearchResultsView;
