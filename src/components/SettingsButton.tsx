import { useRef } from 'react';
import { Settings, X } from 'lucide-react';
import { SKIP_INTERVALS } from '../types';
import type { CellularDownload, SkipInterval } from '../types';
import type { Preferences } from '../services/preferences';

interface Props {
  preferences: Preferences;
  onChange: (change: Partial<Preferences>) => void;
}

const selectClass = 'h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400';

export default function SettingsButton({ preferences, onChange }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-controls="podcast-settings"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-blue-300 hover:bg-slate-800"
        onClick={event => {
          event.currentTarget.focus();
          dialogRef.current?.showModal();
        }}
      >
        <Settings size={16} aria-hidden="true" /> Settings
      </button>
      <dialog
        ref={dialogRef}
        id="podcast-settings"
        aria-labelledby="settings-heading"
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
      </dialog>
    </>
  );
}
