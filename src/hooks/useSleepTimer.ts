import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  SLEEP_TIMER_EXTENSION_MS, SLEEP_TIMER_FADE_MS, extend, shouldStop, sleepTimerLabel, startSleepTimer,
} from '../services/sleepTimer';
import type { SleepTimer, SleepTimerControls, SleepTimerOption } from '../services/sleepTimer';

interface Fade {
  startedAt: number;
  volume: number;
  interval: number;
}

/**
 * The web player's sleep timer. A `setTimeout` covers foreground tabs, and `onTimeUpdate` covers background tabs,
 * where timers are throttled but media events still fire. When the timer runs out, the volume fades out over
 * `SLEEP_TIMER_FADE_MS`, then `pause` stops playback through the normal pause path and the volume is restored.
 */
export function useSleepTimer(audioRef: RefObject<HTMLAudioElement | null>, pause: () => void) {
  const [sleepTimer, setTimerState] = useState<SleepTimer | null>(null);
  const timer = useRef<SleepTimer | null>(null);
  const fade = useRef<Fade | null>(null);
  const pauseRef = useRef(pause);
  pauseRef.current = pause;

  const update = useCallback((next: SleepTimer | null) => {
    timer.current = next;
    setTimerState(next);
  }, []);

  /** Stops fading and puts the volume back. */
  const abortFade = useCallback(() => {
    const current = fade.current;
    if (!current) return;
    fade.current = null;
    window.clearInterval(current.interval);
    if (audioRef.current) audioRef.current.volume = current.volume;
  }, [audioRef]);

  const stepFade = useCallback(() => {
    const current = fade.current;
    const audio = audioRef.current;
    if (!current) return;
    const progress = (Date.now() - current.startedAt) / SLEEP_TIMER_FADE_MS;
    if (audio && progress < 1) {
      audio.volume = current.volume * Math.max(0, 1 - progress);
      return;
    }
    // Clear the fade first, so the pause event below isn't taken for a user pause.
    fade.current = null;
    window.clearInterval(current.interval);
    update(null);
    pauseRef.current();
    if (audio) audio.volume = current.volume;
  }, [audioRef, update]);

  /** Starts the fade once. Timers that run out while paused just end. */
  const fire = useCallback(() => {
    const audio = audioRef.current;
    if (fade.current || !timer.current) return;
    if (!audio || audio.paused) {
      update(null);
      return;
    }
    fade.current = { startedAt: Date.now(), volume: audio.volume, interval: window.setInterval(() => stepFade(), 100) };
  }, [audioRef, stepFade, update]);

  useEffect(() => {
    if (sleepTimer?.kind !== 'time') return;
    const id = window.setTimeout(fire, Math.max(0, sleepTimer.endsAt - Date.now()));
    return () => window.clearTimeout(id);
  }, [sleepTimer, fire]);

  useEffect(() => () => abortFade(), [abortFade]);

  const setSleepTimer = useCallback((option: SleepTimerOption) => {
    abortFade();
    update(startSleepTimer(option, Date.now()));
  }, [abortFade, update]);

  const extendSleepTimer = useCallback(() => {
    if (!timer.current) return;
    abortFade();
    update(extend(timer.current, SLEEP_TIMER_EXTENSION_MS, Date.now()));
  }, [abortFade, update]);

  const cancelSleepTimer = useCallback(() => {
    abortFade();
    update(null);
  }, [abortFade, update]);

  /** Call from `onTimeUpdate` with the media position in seconds. */
  const checkSleepTimer = useCallback((position: number, episodeId: string | undefined) => {
    if (fade.current) stepFade();
    else if (shouldStop(timer.current, { now: Date.now(), position, episodeId })) fire();
  }, [fire, stepFade]);

  /** Call before changing episodes. A timer that is fading out ends at full volume; other timers keep running. */
  const cancelSleepFade = useCallback(() => {
    if (!fade.current) return;
    abortFade();
    update(null);
  }, [abortFade, update]);

  /** Call from `onPause`. Pausing mid-fade, from the UI or elsewhere, ends the timer at full volume. */
  const onSleepPause = useCallback(() => {
    if (!audioRef.current?.ended) cancelSleepFade();
  }, [audioRef, cancelSleepFade]);

  /**
   * Call when an episode ends. Returns whether the next episode should load paused: for "end of episode", a
   * timer fading out or already run out, or a `position` timer on the finished episode. Those timers are cleared.
   */
  const endSleepTimerWithEpisode = useCallback((episodeId: string) => {
    const current = timer.current;
    const stop = current?.kind === 'episode' || !!fade.current
      || shouldStop(current, { now: Date.now(), position: Infinity, episodeId });
    if (stop) {
      abortFade();
      update(null);
    }
    return stop;
  }, [abortFade, update]);

  const controls: SleepTimerControls = { sleepTimer, setSleepTimer, extendSleepTimer, cancelSleepTimer };
  return { controls, checkSleepTimer, onSleepPause, cancelSleepFade, endSleepTimerWithEpisode };
}

/** The sleep button's label, or null without a timer. Re-renders about once a second while a `time` timer runs. */
export function useSleepTimerLabel(timer: SleepTimer | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (timer?.kind !== 'time') return;
    let id = 0;
    const schedule = () => {
      const left = timer.endsAt - Date.now();
      if (left <= 0) return;
      // Wake just after the displayed second changes.
      id = window.setTimeout(() => {
        setTick(tick => tick + 1);
        schedule();
      }, (left % 1000 || 1000) + 20);
    };
    schedule();
    return () => window.clearTimeout(id);
  }, [timer]);
  return timer ? sleepTimerLabel(timer, Date.now()) : null;
}
