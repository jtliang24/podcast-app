import React from 'react';
import { 
  Upload, Download, HardDrive, Clock, Trash2, 
  FileJson, Save 
} from 'lucide-react';
import type { AppState, Podcast } from '../types';

interface SidebarProps {
  state: AppState;
  viewMode: 'search' | 'downloads' | 'new-releases';
  setViewMode: (mode: 'search' | 'downloads' | 'new-releases') => void;
  selectedPodcast: Podcast | null;
  selectPodcast: (podcast: Podcast) => void;
  handleUnsubscribe: (feedUrl: string) => void;
  handleImportOPML: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleExportOPML: () => void;
  handleImportState: (e: React.ChangeEvent<HTMLInputElement>) => void;
  exportState: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  state,
  viewMode,
  setViewMode,
  selectedPodcast,
  selectPodcast,
  handleUnsubscribe,
  handleImportOPML,
  handleExportOPML,
  handleImportState,
  exportState
}) => {
  return (
    <aside className="w-64 border-r border-slate-800 flex flex-col bg-slate-900">
      <div className="p-6 border-b border-slate-800 font-bold flex justify-between items-center">
        <span className="tracking-tight">Subscriptions</span>
        <div className="flex space-x-2 text-slate-500">
          <label className="cursor-pointer hover:text-white transition-colors" title="Import OPML">
            <Upload size={16} />
            <input type="file" className="hidden" onChange={handleImportOPML} accept=".opml,.xml" />
          </label>
          <button onClick={handleExportOPML} className="hover:text-white transition-colors" title="Export OPML">
            <Download size={16} />
          </button>
        </div>
      </div>
      
      <div className="p-4 border-b border-slate-800 flex flex-col space-y-2">
         <button
           onClick={() => setViewMode('downloads')}
           className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-colors ${viewMode === 'downloads' ? 'bg-blue-600' : 'hover:bg-slate-800 text-slate-300'}`}
         >
           <HardDrive size={18} />
           <span className="font-bold text-sm">Downloads</span>
         </button>
         <button
           onClick={() => setViewMode('new-releases')}
           className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-colors ${viewMode === 'new-releases' ? 'bg-blue-600' : 'hover:bg-slate-800 text-slate-300'}`}
         >
           <Clock size={18} />
           <span className="font-bold text-sm">New Releases</span>
         </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {state.subscriptions.map(p => (
          <div key={p.feedUrl} className="group relative">
            <button 
              onClick={() => selectPodcast(p)} 
              className={`w-full text-left p-4 hover:bg-white/5 flex items-center space-x-3 transition-colors ${viewMode === 'search' && selectedPodcast?.feedUrl === p.feedUrl ? 'bg-white/10' : ''}`}
            >
              <img src={p.artworkUrl} className="w-10 h-10 rounded shadow-lg bg-slate-800" alt="" />
              <div className="truncate text-xs font-bold">{p.title}</div>
            </button>
            <button onClick={(e) => { e.stopPropagation(); handleUnsubscribe(p.feedUrl); }} className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Data Portability Section */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/30">
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 px-2">Data Portability</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800 hover:bg-slate-700 cursor-pointer transition-colors text-slate-300">
            <FileJson size={16} className="mb-1" />
            <span className="text-[10px] font-bold">Import</span>
            <input type="file" className="hidden" accept=".json" onChange={handleImportState} />
          </label>
          <button onClick={exportState} className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800 hover:bg-slate-700 transition-colors text-slate-300">
            <Save size={16} className="mb-1" />
            <span className="text-[10px] font-bold">Export</span>
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
