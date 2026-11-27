import { useEffect, useId, useRef, useState } from 'react';
import { MAX_SPEED, MIN_SPEED, SPEED_PRESETS } from '../types';
import { formatSpeed } from '../services/preferences';

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

/** A button showing the current speed that opens a small sheet to change it. */
export default function SpeedControl({ speed, hasOverride, canOverride, disabled, onSpeed, onOverride, className = '', placement = 'above' }: SpeedControlProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const sheetId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

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
          button.current?.focus();
          setOpen(false);
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
        onClick={() => setOpen(!open)}
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
                aria-pressed={preset === speed}
                onClick={() => onSpeed(preset)}
                className={`min-h-9 rounded-full px-3 text-xs font-bold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${preset === speed ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}
              >
                {formatSpeed(preset)}
              </button>
            ))}
          </div>
          <label className="block space-y-1">
            <span className="flex justify-between text-slate-200">
              <span>Speed</span>
              <span className="font-mono font-bold tabular-nums" aria-hidden="true">{formatSpeed(speed)}</span>
            </span>
            <input
              type="range"
              min={MIN_SPEED}
              max={MAX_SPEED}
              step={0.05}
              value={speed}
              aria-valuetext={formatSpeed(speed)}
              onChange={event => onSpeed(event.currentTarget.valueAsNumber)}
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
