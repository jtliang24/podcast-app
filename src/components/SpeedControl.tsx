import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MAX_SPEED, MIN_SPEED, SPEED_PRESETS } from '../types';
import { formatSpeed, roundSpeed } from '../services/preferences';

interface SpeedControlProps {
  /** Effective speed of the current episode. */
  speed: number;
  /** Whether the current podcast has its own speed override. */
  hasOverride: boolean;
  /** Without a podcast there is nothing to override, so the switch is disabled. */
  canOverride: boolean;
  disabled?: boolean;
  onSpeed: (speed: number) => void;
  onOverride: (enabled: boolean) => void;
  className?: string;
  /** Where the sheet opens, relative to the button. */
  placement?: 'above' | 'below';
}

/** How long the slider waits after its last change before saving, for input without a pointer or key release. */
const SLIDER_COMMIT_DELAY_MS = 300;

/** A button showing the current speed that opens a small sheet to change it. */
export default function SpeedControl({ speed, hasOverride, canOverride, disabled, onSpeed, onOverride, className = '', placement = 'above' }: SpeedControlProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const sheetId = useId();
  // The slider shows a draft while it moves and saves once it settles, not on every input event.
  const [draft, setDraft] = useState<number | null>(null);
  const [savedSpeed, setSavedSpeed] = useState(speed);
  const pending = useRef<number | null>(null);
  const commitTimer = useRef(0);
  const onSpeedRef = useRef(onSpeed);
  onSpeedRef.current = onSpeed;
  const shown = draft ?? speed;

  // Drop the draft once the saved speed catches up with it. Saving can finish after the slider was released.
  if (savedSpeed !== speed) {
    setSavedSpeed(speed);
    if (draft === speed) setDraft(null);
  }

  /** Saves the slider's unsaved value, if any. */
  const commit = useCallback(() => {
    window.clearTimeout(commitTimer.current);
    const value = pending.current;
    if (value === null) return;
    pending.current = null;
    onSpeedRef.current(value);
  }, []);

  const close = useCallback(() => {
    commit();
    setDraft(null);
    setOpen(false);
  }, [commit]);

  useEffect(() => commit, [commit]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  return (
    <div
      ref={root}
      className="relative"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          button.current?.focus();
          close();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={`Playback speed ${formatSpeed(speed)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? sheetId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className={`rounded-lg bg-slate-800 px-3 py-1.5 font-mono text-xs font-bold tabular-nums text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 ${className}`}
      >
        {formatSpeed(speed)}
      </button>
      {open && (
        <div
          id={sheetId}
          role="dialog"
          aria-label="Playback speed"
          className={`absolute right-0 z-50 w-72 max-w-[calc(100vw-2rem)] space-y-4 rounded-xl border border-slate-700 bg-slate-800 p-4 text-left font-sans text-sm font-normal text-white shadow-2xl ${placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        >
          <div className="flex flex-wrap gap-2">
            {SPEED_PRESETS.map(preset => (
              <button
                key={preset}
                type="button"
                aria-pressed={preset === shown}
                onClick={() => {
                  window.clearTimeout(commitTimer.current);
                  pending.current = null;
                  setDraft(null);
                  onSpeed(preset);
                }}
                className={`min-h-9 rounded-full px-3 text-xs font-bold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${preset === shown ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}
              >
                {formatSpeed(preset)}
              </button>
            ))}
          </div>
          <label className="block space-y-1">
            <span className="flex justify-between text-slate-200">
              <span>Speed</span>
              <span className="font-mono font-bold tabular-nums" aria-hidden="true">{formatSpeed(shown)}</span>
            </span>
            <input
              type="range"
              min={MIN_SPEED}
              max={MAX_SPEED}
              step={0.05}
              value={shown}
              aria-valuetext={formatSpeed(shown)}
              onChange={event => {
                // Rounded like the saved speed (the slider can give 1.1500000000000001), so the two compare equal.
                const value = roundSpeed(event.currentTarget.valueAsNumber);
                setDraft(value);
                pending.current = value;
                window.clearTimeout(commitTimer.current);
                commitTimer.current = window.setTimeout(commit, SLIDER_COMMIT_DELAY_MS);
              }}
              onPointerUp={commit}
              onKeyUp={commit}
              onBlur={commit}
              className="h-8 w-full cursor-pointer accent-blue-500"
            />
          </label>
          <label className={`flex items-center justify-between gap-3 text-slate-200 ${canOverride ? '' : 'opacity-50'}`}>
            <span>Use for this podcast only</span>
            <input
              type="checkbox"
              role="switch"
              checked={hasOverride}
              disabled={!canOverride}
              onChange={event => onOverride(event.currentTarget.checked)}
              className="h-5 w-5 shrink-0 accent-blue-500"
            />
          </label>
        </div>
      )}
    </div>
  );
}
