import assert from 'node:assert/strict';
import test from 'node:test';
import { getPreferences, roundSpeed, speedFor } from '../src/services/preferences.ts';
import { INITIAL_STATE, MAX_SPEED, MIN_SPEED, SPEED_PRESETS } from '../src/types.ts';

const withSpeed = (playbackSpeed, podcastPlaybackSpeeds) => ({ ...INITIAL_STATE, playbackSpeed, podcastPlaybackSpeeds });

test('speed defaults to 1 when missing or invalid', () => {
  assert.equal(getPreferences(INITIAL_STATE).playbackSpeed, 1);
  for (const bad of ['2', null, NaN, Infinity]) assert.equal(getPreferences(withSpeed(bad)).playbackSpeed, 1);
});

test('speed is clamped to the allowed range', () => {
  assert.equal(getPreferences(withSpeed(0.1)).playbackSpeed, MIN_SPEED);
  assert.equal(getPreferences(withSpeed(10)).playbackSpeed, MAX_SPEED);
  assert.equal(getPreferences(withSpeed(-1)).playbackSpeed, MIN_SPEED);
});

test('speed is rounded to 0.05 and presets are unchanged', () => {
  assert.equal(getPreferences(withSpeed(1.234)).playbackSpeed, 1.25);
  assert.equal(getPreferences(withSpeed(1.52)).playbackSpeed, 1.5);
  for (const preset of SPEED_PRESETS) assert.equal(getPreferences(withSpeed(preset)).playbackSpeed, preset);
});

test('roundSpeed matches the stored speed for slider values', () => {
  assert.equal(roundSpeed(1.1500000000000001), 1.15);
  assert.equal(roundSpeed(1.15), getPreferences(withSpeed(1.1500000000000001)).playbackSpeed);
  assert.equal(roundSpeed(0.1), MIN_SPEED);
  assert.equal(roundSpeed(10), MAX_SPEED);
});

test('speedFor prefers a podcast override over the global speed', () => {
  const state = withSpeed(1.5, { feed: 2, odd: 9, slow: 0.73 });
  assert.equal(speedFor(state, 'feed'), 2);
  assert.equal(speedFor(state, 'other'), 1.5);
  assert.equal(speedFor(state, undefined), 1.5);
  assert.equal(speedFor(state, 'odd'), MAX_SPEED);
  assert.equal(speedFor(state, 'slow'), 0.75);
  assert.equal(speedFor(INITIAL_STATE, 'feed'), 1);
  assert.equal(speedFor(withSpeed(undefined, { feed: 'fast' }), 'feed'), 1);
  assert.equal(speedFor(withSpeed(1.2, {}), 'toString'), 1.2);
});
