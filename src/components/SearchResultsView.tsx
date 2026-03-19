import React from 'react';
import { Plus } from 'lucide-react';
import type { Podcast } from '../types';

interface SearchResultsViewProps {
  searchResults: Podcast[];
  handleSubscribe: (podcast: Podcast) => void;
}

const SearchResultsView: React.FC<SearchResultsViewProps> = ({
  searchResults,
  handleSubscribe
}) => {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
      {searchResults.map(p => (
        <div key={p.feedUrl} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 group hover:border-slate-700 transition-all">
          <div className="relative overflow-hidden rounded-xl mb-4">
            <img src={p.artworkUrl} className="w-full aspect-square shadow-lg bg-slate-800" alt="" />
            <button 
              onClick={() => handleSubscribe(p)} 
              className="absolute bottom-2 right-2 bg-blue-600 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Plus size={20}/>
            </button>
          </div>
          <h3 className="font-bold truncate text-sm mb-1">{p.title}</h3>
          <p className="text-[10px] text-slate-500 truncate">{p.author}</p>
        </div>
      ))}
    </div>
  );
};

export default SearchResultsView;
