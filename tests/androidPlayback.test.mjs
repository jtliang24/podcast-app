import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAndroidPlayback } from '../src/services/androidPlaybackState.ts';
import { INITIAL_STATE } from '../src/types.ts';

const episode = id => ({ id, title: id, audioUrl: `https://example.org/${id}.mp3`, duration: 60 });
const first = episode('first');
const second = episode('second');
const third = episode('third');

test('reconciles episodes completed and started while the WebView was suspended', () => {
  const state = { ...INITIAL_STATE, queue: [first, second, third], lastPlayingEpisode: first };
  const restored = applyAndroidPlayback(state, {
    episode: third,
    changes: [
      { episode: first, finished: true, updated: 100 },
      { episode: second, finished: true, updated: 200 },
      { episode: third, time: 15, duration: 60, updated: 300 },
    ],
  });

  assert.deepEqual(restored.queue, [third]);
  assert.deepEqual(restored.playedEpisodes, { first: true, second: true });
  assert.equal(restored.lastPlayingEpisode, third);
  assert.equal(restored.playbackProgress[third.audioUrl].currentTime, 15);

  const ended = applyAndroidPlayback(restored, {
    episode: null,
    changes: [{ episode: third, finished: true, updated: 400 }],
  });
  assert.equal(ended.lastPlayingEpisode, null);
  assert.deepEqual(ended.queue, []);
  assert.deepEqual(ended.playbackProgress, {});
});

test('a pending native checkpoint preserves newer listening progress from Drive', () => {
  const recent = { currentTime: 40, lastUpdated: 500 };
  const state = {
    ...INITIAL_STATE, queue: [first, second], lastPlayingEpisode: first, playbackProgress: { [first.audioUrl]: recent },
  };
  const restored = applyAndroidPlayback(state, {
    episode: second,
    changes: [
      { episode: first, finished: true, updated: 300 },
      { episode: second, time: 15, duration: 60, updated: 400 },
    ],
  });

  assert.equal(restored.lastPlayingEpisode, first);
  assert.deepEqual(restored.queue, [first, second]);
  assert.equal(restored.playbackProgress[first.audioUrl], recent);
  assert.equal(restored.playbackProgress[second.audioUrl].currentTime, 15);
});
