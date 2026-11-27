import { useEffect, useId, useRef, useState } from 'react';
import { Moon } from 'lucide-react';
import { SLEEP_TIMER_OPTIONS, canExtend, sleepTimerOptionLabel } from '../services/sleepTimer';
import type { SleepTimerControls, SleepTimerOption } from '../services/sleepTimer';
import { useSleepTimerLabel } from '../hooks/useSleepTimer';

interface SleepTimerControlProps extends SleepTimerControls {
  disabled?: boolean;
  className?: string;
  /** Where the sheet opens, relative to the button. */
  placement?: 'above' | 'below';
}

/** A moon button showing the time left that opens a small sheet to set, extend, or cancel the sleep timer. */
export default function SleepTimerControl({
  sleepTimer, setSleepTimer, extendSleepTimer, cancelSleepTimer, disabled, className = '', placement = 'above',
}: SleepTimerControlProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const sheetId = useId();
  const label = useSleepTimerLabel(sleepTimer);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Closing returns focus to the button, because the chosen control can disappear from the sheet.
  const close = () => {
    button.current?.focus();
    setOpen(false);
  };
  const choose = (option: SleepTimerOption) => {
    setSleepTimer(option);
    close();
  };

  return (
    <div
      ref={root}
      className="relative"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={label ? `Sleep timer: ${label}` : 'Sleep timer'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? sheetId : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold tabular-nums disabled:opacity-30 ${sleepTimer ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:hover:bg-slate-800'} ${className}`}
      >
        <Moon size={16} aria-hidden="true" />
        {label && <span>{label}</span>}
      </button>
      {open && (
        <div
          id={sheetId}
          role="dialog"
          aria-label="Sleep timer"
          className={`absolute right-0 z-50 w-72 max-w-[calc(100vw-2rem)] space-y-4 rounded-xl border border-slate-700 bg-slate-800 p-4 text-left font-sans text-sm font-normal text-white shadow-2xl ${placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        >
          {sleepTimer && (
            <div className="space-y-3">
              <p className="text-slate-200">
                {sleepTimer.kind === 'time' ? <>Stops in <span className="font-mono font-bold tabular-nums">{label}</span></> : `Stops at ${label?.toLowerCase()}`}
              </p>
              <div className="flex gap-2">
                {canExtend(sleepTimer) && (
                  <button
                    type="button"
                    onClick={extendSleepTimer}
                    className="min-h-9 flex-1 rounded-full bg-slate-700 px-3 text-xs font-bold text-slate-200 hover:bg-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
                  >
                    +5 min
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    cancelSleepTimer();
                    close();
                  }}
                  className="min-h-9 flex-1 rounded-full bg-slate-700 px-3 text-xs font-bold text-red-300 hover:bg-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
                >
                  Cancel timer
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {SLEEP_TIMER_OPTIONS.map(option => {
              const active = option.kind === 'episode' && sleepTimer?.kind === 'episode';
              return (
                <button
                  key={sleepTimerOptionLabel(option)}
                  type="button"
                  aria-pressed={active}
                  onClick={() => choose(option)}
                  className={`min-h-9 rounded-full px-3 text-xs font-bold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${active ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}
                >
                  {sleepTimerOptionLabel(option)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
