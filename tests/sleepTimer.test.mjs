import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SLEEP_TIMER_OPTIONS, canExtend, extend, formatSleepRemaining, remaining, shouldStop, sleepTimerLabel, sleepTimerOptionLabel, startSleepTimer,
} from '../src/services/sleepTimer.ts';

const MINUTE = 60_000;
const now = 1_000_000;

test('options are the listed durations plus end of episode', () => {
  assert.deepEqual(SLEEP_TIMER_OPTIONS.map(option => option.kind === 'time' ? option.minutes : option.kind),
    [5, 10, 15, 30, 45, 60, 90, 'episode']);
  assert.deepEqual(startSleepTimer({ kind: 'time', minutes: 15 }, now), { kind: 'time', endsAt: now + 15 * MINUTE });
  assert.deepEqual(startSleepTimer({ kind: 'episode' }, now), { kind: 'episode' });
  assert.deepEqual(startSleepTimer({ kind: 'position', until: 600, episodeId: 'a' }, now), { kind: 'position', until: 600, episodeId: 'a' });
  assert.equal(sleepTimerOptionLabel({ kind: 'position', until: 600, episodeId: 'a' }), 'End of chapter');
});

test('remaining counts wall-clock time for time timers and never goes below 0', () => {
  const timer = { kind: 'time', endsAt: now + 5 * MINUTE };
  assert.equal(remaining(timer, now), 5 * MINUTE);
  assert.equal(remaining(timer, now + 2 * MINUTE), 3 * MINUTE);
  assert.equal(remaining(timer, now + 6 * MINUTE), 0);
});

test('remaining counts media time for position timers on their own episode only', () => {
  const timer = { kind: 'position', until: 600, episodeId: 'a' };
  assert.equal(remaining(timer, now, { position: 540, episodeId: 'a' }), 60_000);
  assert.equal(remaining(timer, now, { position: 700, episodeId: 'a' }), 0);
  assert.equal(remaining(timer, now, { position: 540, episodeId: 'b' }), null);
  assert.equal(remaining(timer, now), null);
  assert.equal(remaining({ kind: 'episode' }, now, { position: 0, episodeId: 'a' }), null);
});

test('extend adds time, restarting from now once a time timer has run out', () => {
  const timer = { kind: 'time', endsAt: now + MINUTE };
  assert.deepEqual(extend(timer, 5 * MINUTE), { kind: 'time', endsAt: now + 6 * MINUTE });
  assert.deepEqual(extend(timer, 5 * MINUTE, now), { kind: 'time', endsAt: now + 6 * MINUTE });
  assert.deepEqual(extend(timer, 5 * MINUTE, now + 3 * MINUTE), { kind: 'time', endsAt: now + 8 * MINUTE });
  assert.deepEqual(extend({ kind: 'position', until: 600, episodeId: 'a' }, 5 * MINUTE),
    { kind: 'position', until: 900, episodeId: 'a' });
  const episode = { kind: 'episode' };
  assert.equal(extend(episode, 5 * MINUTE), episode);
  assert.equal(canExtend(episode), false);
  assert.equal(canExtend(timer), true);
});

test('shouldStop handles each kind', () => {
  const at = (time, position = 0, episodeId = 'a') => ({ now: time, position, episodeId });
  assert.equal(shouldStop(null, at(now)), false);
  const timer = { kind: 'time', endsAt: now + MINUTE };
  assert.equal(shouldStop(timer, at(now)), false);
  assert.equal(shouldStop(timer, at(now + MINUTE)), true);
  assert.equal(shouldStop(timer, at(now + 2 * MINUTE, 0, undefined)), true);
  assert.equal(shouldStop({ kind: 'episode' }, at(now + 99 * MINUTE, Infinity)), false);
  const chapter = { kind: 'position', until: 600, episodeId: 'a' };
  assert.equal(shouldStop(chapter, at(now, 599.9)), false);
  assert.equal(shouldStop(chapter, at(now, 600)), true);
});

test('a position timer is ignored after switching episodes', () => {
  const chapter = { kind: 'position', until: 600, episodeId: 'a' };
  assert.equal(shouldStop(chapter, { now, position: 1200, episodeId: 'b' }), false);
  assert.equal(shouldStop(chapter, { now, position: Infinity, episodeId: undefined }), false);
});

test('labels show the time left or the stopping point', () => {
  assert.equal(formatSleepRemaining(5 * MINUTE), '5:00');
  assert.equal(formatSleepRemaining(754_001), '12:35');
  assert.equal(formatSleepRemaining(90 * MINUTE), '1:30:00');
  assert.equal(formatSleepRemaining(-5), '0:00');
  assert.equal(sleepTimerLabel({ kind: 'time', endsAt: now + 754_000 }, now), '12:34');
  assert.equal(sleepTimerLabel({ kind: 'episode' }, now), 'End of episode');
});
