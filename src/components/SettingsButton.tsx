import { useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { FileJson, Save, Settings, X } from 'lucide-react';
import { SKIP_INTERVALS } from '../types';
import type { CellularDownload, SkipInterval } from '../types';
import type { Preferences } from '../services/preferences';

interface Props {
  preferences: Preferences;
  onChange: (change: Partial<Preferences>) => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
  storageError: string | null;
  androidFileActions?: {
    linkedFile: boolean;
    reconnectFile: boolean;
    choosingFile: boolean;
    linkAndroidFile: (action: 'open' | 'create' | 'reconnect') => Promise<void>;
  };
}

const selectClass = 'h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400';
const fileButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50';
const tabs = [
  { id: 'preferences', label: 'Preferences' },
  { id: 'portability', label: 'Data Portability' },
] as const;
type Tab = typeof tabs[number]['id'];

export default function SettingsButton({ preferences, onChange, onImport, onExport, storageError, androidFileActions }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>('preferences');

  const focusTab = (next: Tab) => {
    setTab(next);
    dialogRef.current?.querySelector<HTMLButtonElement>(`#settings-tab-${next}`)?.focus();
  };

  const open = (next: Tab, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    trigger.focus();
    dialogRef.current?.showModal();
    focusTab(next);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex(item => item.id === tab);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : null;
    if (next === null) return;
    event.preventDefault();
    focusTab(tabs[next].id);
  };

  return (
    <>
      <button
        ref={settingsRef}
        type="button"
        aria-haspopup="dialog"
        aria-controls="podcast-settings"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-blue-300 hover:bg-slate-800"
        onClick={event => open('preferences', event.currentTarget)}
      >
        <Settings size={16} aria-hidden="true" /> Settings
      </button>
      {androidFileActions?.reconnectFile && (
        <button type="button" className="order-last text-amber-300" aria-haspopup="dialog" aria-controls="podcast-settings"
          disabled={androidFileActions.choosingFile} onClick={event => open('portability', event.currentTarget)}>
          Reconnect JSON file
        </button>
      )}
      <dialog
        ref={dialogRef}
        id="podcast-settings"
        aria-labelledby="settings-heading"
        onClose={() => {
          const trigger = triggerRef.current;
          (trigger?.isConnected && !trigger.disabled ? trigger : settingsRef.current)?.focus({ preventScroll: true });
        }}
        className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white shadow-2xl backdrop:bg-black/70 sm:p-6"
      >
        <header className="mb-4 flex items-center justify-between gap-4">
          <h2 id="settings-heading" className="text-xl font-bold">Settings</h2>
          <form method="dialog">
            <button type="submit" aria-label="Close Settings" className="grid h-11 w-11 place-items-center rounded-full bg-slate-800 hover:bg-slate-700">
              <X size={20} aria-hidden="true" />
            </button>
          </form>
        </header>
        <div role="tablist" aria-label="Settings sections" className="mb-4 flex flex-wrap gap-2 border-b border-slate-700" onKeyDown={onTabKeyDown}>
          {tabs.map(({ id, label }) => (
            <button key={id} type="button" role="tab" id={`settings-tab-${id}`} aria-selected={tab === id}
              aria-controls={`settings-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => focusTab(id)}
              className={`min-h-11 border-b-2 px-2 text-sm font-semibold ${tab === id ? 'border-blue-400 text-blue-300' : 'border-transparent text-slate-300 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
        <div id="settings-panel-preferences" role="tabpanel" aria-labelledby="settings-tab-preferences" tabIndex={0} hidden={tab !== 'preferences'}>
          <section aria-labelledby="download-settings-heading" className="space-y-3">
            <h3 id="download-settings-heading" className="font-semibold">Downloads</h3>
            <label className="block space-y-1 text-sm text-slate-200">
              <span>Download on Cellular</span>
              <select
                className={selectClass}
                aria-describedby="cellular-help"
                value={preferences.cellularDownload}
                onChange={event => onChange({ cellularDownload: event.currentTarget.value as CellularDownload })}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="ask">Ask each time</option>
              </select>
            </label>
            <p id="cellular-help" className="text-xs leading-relaxed text-slate-400">
              Browsers that can’t identify the connection type allow downloads regardless of this setting.
            </p>
            <label className="block space-y-1 text-sm text-slate-200">
              <span>Automatically download queued episodes</span>
              <select className={selectClass} value={String(preferences.autoDownloadQueued)} onChange={event => onChange({ autoDownloadQueued: event.currentTarget.value === 'true' })}>
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            </label>
            <label className="block space-y-1 text-sm text-slate-200">
              <span>Automatically remove finished downloads</span>
              <select className={selectClass} value={String(preferences.autoRemoveFinishedDownloads)} onChange={event => onChange({ autoRemoveFinishedDownloads: event.currentTarget.value === 'true' })}>
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            </label>
          </section>
          <section aria-labelledby="playback-settings-heading" className="mt-5 space-y-3 border-t border-slate-700 pt-4">
            <h3 id="playback-settings-heading" className="font-semibold">Playback</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm text-slate-200">
                <span>Skip backward</span>
                <select className={selectClass} value={preferences.skipBackwardSeconds} onChange={event => onChange({ skipBackwardSeconds: Number(event.currentTarget.value) as SkipInterval })}>
                  {SKIP_INTERVALS.map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm text-slate-200">
                <span>Skip forward</span>
                <select className={selectClass} value={preferences.skipForwardSeconds} onChange={event => onChange({ skipForwardSeconds: Number(event.currentTarget.value) as SkipInterval })}>
                  {SKIP_INTERVALS.map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
                </select>
              </label>
            </div>
          </section>
        </div>
        {/* Data Portability Section */}
        <div id="settings-panel-portability" role="tabpanel" aria-labelledby="settings-tab-portability" hidden={tab !== 'portability'}>
          <div className="flex flex-wrap gap-2">
            <input ref={importRef} type="file" hidden accept=".json" onChange={onImport} />
            <button type="button" className={fileButtonClass} onClick={() => importRef.current?.click()}>
              <FileJson size={16} aria-hidden="true" /> Import JSON
            </button>
            <button type="button" className={fileButtonClass} onClick={onExport}>
              <Save size={16} aria-hidden="true" /> Export JSON
            </button>
          </div>
          {androidFileActions && (
            <section aria-labelledby="linked-json-heading" className="mt-5 space-y-3 border-t border-slate-700 pt-4">
              <h3 id="linked-json-heading" className="font-semibold">Linked JSON file</h3>
              <p role="status" className="text-sm text-slate-300">
                {androidFileActions.reconnectFile ? 'File access was lost. Reconnect to write this library to the selected JSON file.'
                  : androidFileActions.linkedFile ? 'JSON file linked' : 'No JSON file linked'}
              </p>
              <div className="flex flex-wrap gap-2">
                {androidFileActions.reconnectFile && (
                  <button type="button" className={fileButtonClass} disabled={androidFileActions.choosingFile}
                    onClick={() => void androidFileActions.linkAndroidFile('reconnect')}>Reconnect JSON file</button>
                )}
                <button type="button" className={fileButtonClass} disabled={androidFileActions.choosingFile}
                  onClick={() => void androidFileActions.linkAndroidFile('open')}>Open and link JSON file</button>
                <button type="button" className={fileButtonClass} disabled={androidFileActions.choosingFile}
                  onClick={() => void androidFileActions.linkAndroidFile('create')}>Create linked JSON file</button>
              </div>
            </section>
          )}
          {storageError && <p role="alert" className="mt-3 text-sm text-red-300">{storageError}</p>}
        </div>
      </dialog>
    </>
  );
}
