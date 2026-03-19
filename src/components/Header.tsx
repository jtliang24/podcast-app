import React from 'react';
import { Search, Link as LinkIcon, Loader2, AlertCircle } from 'lucide-react';

interface HeaderProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  urlInput: string;
  setUrlInput: (url: string) => void;
  handleSearch: (e: React.FormEvent) => void;
  handleAddByUrl: (e: React.FormEvent) => void;
  isAddingByUrl: boolean;
  error: string | null;
  importingStatus: string | null;
}

const Header: React.FC<HeaderProps> = ({
  searchQuery,
  setSearchQuery,
  urlInput,
  setUrlInput,
  handleSearch,
  handleAddByUrl,
  isAddingByUrl,
  error,
  importingStatus
}) => {
  return (
    <header className="p-6 flex flex-col items-center bg-slate-950/50">
      <div className="w-full max-lg flex flex-col space-y-4">
        <form onSubmit={handleSearch} className="relative w-full group">
          <Search className="absolute left-4 top-3.5 text-slate-500 group-focus-within:text-blue-500 transition-colors" size={18} />
          <input 
            value={searchQuery} 
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-3 pl-12 pr-4 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            placeholder="Search podcasts..."
          />
        </form>
        
        <div className="flex items-center space-x-2">
          <div className="h-[1px] flex-1 bg-slate-800"></div>
          <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">or</span>
          <div className="h-[1px] flex-1 bg-slate-800"></div>
        </div>

        <form onSubmit={handleAddByUrl} className="relative w-full group">
          <LinkIcon className="absolute left-4 top-3.5 text-slate-500 group-focus-within:text-emerald-500 transition-colors" size={18} />
          <input 
            value={urlInput} 
            onChange={e => setUrlInput(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-3 pl-12 pr-24 outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
            placeholder="Paste RSS feed URL..."
          />
          <button 
            type="submit"
            disabled={isAddingByUrl || !urlInput}
            className="absolute right-2 top-2 bottom-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-800 disabled:text-slate-500 px-4 rounded-xl text-xs font-bold transition-all flex items-center"
          >
            {isAddingByUrl ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
          </button>
        </form>
      </div>
      {error && (
        <div className="mt-4 flex items-center text-red-400 bg-red-400/10 px-4 py-2 rounded-xl text-xs border border-red-400/20 animate-in fade-in slide-in-from-top-1">
          <AlertCircle size={14} className="mr-2" /> {error}
        </div>
      )}
      {importingStatus && (
        <div className="mt-4 flex items-center text-blue-400 bg-blue-400/10 px-4 py-2 rounded-xl text-xs border border-blue-400/20 animate-in fade-in slide-in-from-top-1">
          <Loader2 size={14} className="mr-2 animate-spin" /> {importingStatus}
        </div>
      )}
    </header>
  );
};

export default Header;
