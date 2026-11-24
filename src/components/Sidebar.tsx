import React, { useMemo } from 'react';
import { 
  Upload, Download, HardDrive, Clock, Trash2, 
  FileJson, Save 
} from 'lucide-react';
import type { AppState, Podcast, SubscriptionSortDirection, SubscriptionSortField } from '../types';
import { sortSubscriptions } from '../services/subscriptionSort';

interface SidebarProps {
  state: AppState;
  onSubscriptionSortChange: (change: Pick<AppState, 'subscriptionSortField' | 'subscriptionSortDirection'>) => void;
  viewMode: 'search' | 'downloads' | 'new-releases';
  setViewMode: (mode: 'search' | 'downloads' | 'new-releases') => void;
  selectedPodcast: Podcast | null;
  selectPodcast: (podcast: Podcast) => void;
  handleUnsubscribe: (feedUrl: string) => void;
  handleImportOPML: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleExportOPML: () => void;
  handleImportState: (e: React.ChangeEvent<HTMLInputElement>) => void;
  exportState: () => void;
  androidFileActions?: {
    linkedFile: boolean;
    reconnectFile: boolean;
    choosingFile: boolean;
    linkAndroidFile: (action: 'open' | 'create' | 'reconnect') => Promise<void>;
  };
}

const Sidebar: React.FC<SidebarProps> = ({
  state,
  onSubscriptionSortChange,
  viewMode,
  setViewMode,
  selectedPodcast,
  selectPodcast,
  handleUnsubscribe,
  handleImportOPML,
  handleExportOPML,
  handleImportState,
  exportState,
  androidFileActions,
}) => {
  const {
    subscriptions, subscriptionSortField = 'release-date', subscriptionSortDirection = 'descending',
    podcastReleaseDates, podcastLastPlayed, newReleases,
  } = state;
  const sortedSubscriptions = useMemo(
    () => sortSubscriptions(subscriptions, subscriptionSortField, subscriptionSortDirection,
      podcastReleaseDates, podcastLastPlayed, newReleases),
    [subscriptions, subscriptionSortField, subscriptionSortDirection, podcastReleaseDates, podcastLastPlayed, newReleases],
  );
  const selectClass = 'min-w-0 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200';

  return (
    <aside className="h-full w-full md:w-64 border-r border-slate-800 flex flex-col bg-slate-900">
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

      <div className="grid grid-cols-[1.25fr_1fr] gap-2 border-b border-slate-800 px-3 py-2">
        <select
          aria-label="Sort podcasts by"
          className={selectClass}
          value={subscriptionSortField}
          onChange={e => onSubscriptionSortChange({ subscriptionSortField: e.target.value as SubscriptionSortField })}
        >
          <option value="release-date">Release Date</option>
          <option value="title">Title</option>
          <option value="date-added">Date Added</option>
          <option value="recently-played">Recently Played</option>
        </select>
        <select
          aria-label="Podcast sort direction"
          className={selectClass}
          value={subscriptionSortDirection}
          onChange={e => onSubscriptionSortChange({ subscriptionSortDirection: e.target.value as SubscriptionSortDirection })}
        >
          <option value="ascending">Ascending</option>
          <option value="descending">Descending</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {sortedSubscriptions.map(p => (
          <div key={p.feedUrl} className="grid grid-cols-[minmax(0,1fr)_auto] items-center pr-2">
            <button 
              onClick={() => selectPodcast(p)} 
              className={`min-w-0 text-left py-4 pl-4 pr-2 hover:bg-white/5 flex items-center gap-3 transition-colors ${viewMode === 'search' && selectedPodcast?.feedUrl === p.feedUrl ? 'bg-white/10' : ''}`}
            >
              <img src={p.artworkUrl} className="w-10 h-10 shrink-0 rounded shadow-lg bg-slate-800" alt="" />
              <span className="min-w-0 truncate text-xs font-bold">{p.title}</span>
            </button>
            <button type="button" onClick={() => handleUnsubscribe(p.feedUrl)} aria-label={`Unsubscribe from ${p.title}`} className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-red-400">
              <Trash2 size={16} aria-hidden="true" />
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
        {androidFileActions && (
          <div className="mt-2 space-y-2 text-xs text-slate-300">
            {androidFileActions.reconnectFile ? (
              <p>File access was lost. Reconnect to write this library to the selected JSON file.</p>
            ) : androidFileActions.linkedFile && <p role="status">JSON file linked</p>}
            <div className="flex flex-wrap gap-2">
              <button className="rounded-lg bg-slate-800 p-2" disabled={androidFileActions.choosingFile}
                onClick={() => void androidFileActions.linkAndroidFile('open')}>Open and link JSON file</button>
              <button className="rounded-lg bg-slate-800 p-2" disabled={androidFileActions.choosingFile}
                onClick={() => void androidFileActions.linkAndroidFile('create')}>Create linked JSON file</button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
