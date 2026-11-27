/**
 * A sleep timer that stops playback on one device. It is device-local and never part of `AppState`.
 * - `time` counts wall-clock time: `endsAt` is a `Date.now()` timestamp in milliseconds.
 * - `episode` stops when the current episode finishes.
 * - `position` stops when episode `episodeId` reaches media position `until`, in seconds (end of chapter).
 */
export type SleepTimer =
  | { kind: 'time'; endsAt: number }
  | { kind: 'episode' }
  | { kind: 'position'; until: number; episodeId: string };

/** A choice offered in the sleep timer sheet. `position` is the end of the current chapter. */
export type SleepTimerOption =
  | { kind: 'time'; minutes: number }
  | { kind: 'episode' }
  | { kind: 'position'; until: number; episodeId: string };

/** Where playback is when a timer is checked. `position` is media time in seconds. */
export interface SleepTimerCheck {
  now: number;
  position: number;
  episodeId?: string;
}

/** The sleep timer API that both player hooks expose. */
export interface SleepTimerControls {
  sleepTimer: SleepTimer | null;
  setSleepTimer: (option: SleepTimerOption) => void;
  /** Adds `SLEEP_TIMER_EXTENSION_MS` to the running timer. */
  extendSleepTimer: () => void;
  cancelSleepTimer: () => void;
}

export const SLEEP_TIMER_MINUTES = [5, 10, 15, 30, 45, 60, 90] as const;
export const SLEEP_TIMER_OPTIONS: readonly SleepTimerOption[] = [
  ...SLEEP_TIMER_MINUTES.map(minutes => ({ kind: 'time' as const, minutes })),
  { kind: 'episode' },
];
/** The **+5 min** button. */
export const SLEEP_TIMER_EXTENSION_MS = 5 * 60_000;
/** How long the volume fades out before the timer pauses playback. */
export const SLEEP_TIMER_FADE_MS = 10_000;

export function startSleepTimer(option: SleepTimerOption, now: number): SleepTimer {
  switch (option.kind) {
    case 'time': return { kind: 'time', endsAt: now + option.minutes * 60_000 };
    case 'episode': return { kind: 'episode' };
    case 'position': return { kind: 'position', until: option.until, episodeId: option.episodeId };
  }
}

/**
 * Milliseconds until the timer stops playback, never below 0.
 * `time` counts wall-clock time. `position` counts media time, so it needs `at`, and is null without it or
 * while another episode plays. `episode` is always null, because the player knows the episode's length.
 */
export function remaining(timer: SleepTimer, now: number, at?: Omit<SleepTimerCheck, 'now'>): number | null {
  switch (timer.kind) {
    case 'time': return Math.max(0, timer.endsAt - now);
    case 'episode': return null;
    case 'position':
      if (!at || at.episodeId !== timer.episodeId) return null;
      return Math.max(0, (timer.until - at.position) * 1000);
  }
}

/** Whether **+5 min** applies. Extending "end of episode" has no meaning. */
export function canExtend(timer: SleepTimer) {
  return timer.kind !== 'episode';
}

/**
 * Pushes the stop back by `ms`. A `time` timer that already expired (for example while fading) extends from `now`
 * when given. A `position` timer moves `until` by `ms` of media time. An `episode` timer is returned unchanged.
 */
export function extend(timer: SleepTimer, ms: number, now?: number): SleepTimer {
  switch (timer.kind) {
    case 'time': return { kind: 'time', endsAt: Math.max(timer.endsAt, now ?? -Infinity) + ms };
    case 'episode': return timer;
    case 'position': return { ...timer, until: timer.until + ms / 1000 };
  }
}

/**
 * Whether the timer has run out. `episode` never does here, because the player stops it when the episode ends.
 * A `position` timer only applies to its own episode.
 */
export function shouldStop(timer: SleepTimer | null, { now, position, episodeId }: SleepTimerCheck) {
  switch (timer?.kind) {
    case 'time': return now >= timer.endsAt;
    case 'position': return episodeId === timer.episodeId && position >= timer.until;
    default: return false;
  }
}

/** `12:34`, or `1:02:03` from an hour up. Rounds up, so a new 5-minute timer reads `5:00`. */
export function formatSleepRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = (total % 60).toString().padStart(2, '0');
  return hours ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** What the sleep button shows while a timer runs. */
export function sleepTimerLabel(timer: SleepTimer, now: number) {
  switch (timer.kind) {
    case 'time': return formatSleepRemaining(timer.endsAt - now);
    case 'episode': return 'End of episode';
    case 'position': return 'End of chapter';
  }
}

export function sleepTimerOptionLabel(option: SleepTimerOption) {
  switch (option.kind) {
    case 'time': return `${option.minutes} min`;
    case 'episode': return 'End of episode';
    case 'position': return 'End of chapter';
  }
}
