import assert from 'node:assert/strict';
import test from 'node:test';
import { androidPlaybackOpen, androidPlaybackQueue, applyAndroidPlayback } from '../src/services/androidPlaybackState.ts';
import { INITIAL_STATE } from '../src/types.ts';

const episode = id => ({ id, title: id, audioUrl: `https://example.org/${id}.mp3`, duration: 60 });
const first = episode('first');
const second = episode('second');
const third = episode('third');

test('reconciles episodes completed and started while the WebView was suspended', () => {
  const state = { ...INITIAL_STATE, queue: { primary: [second], secondary: [third] }, lastPlayingEpisode: first };
  const restored = applyAndroidPlayback(state, {
    episode: third,
    changes: [
      { episode: first, finished: true, updated: 100 },
      { episode: second, finished: true, updated: 200 },
      { episode: third, time: 15, duration: 60, updated: 300 },
    ],
  });

  assert.deepEqual(restored.queue, { primary: [], secondary: [] });
  assert.deepEqual(restored.playedEpisodes, { first: true, second: true });
  assert.equal(restored.lastPlayingEpisode, third);
  assert.equal(restored.playbackProgress[third.audioUrl].currentTime, 15);

  const ended = applyAndroidPlayback(restored, {
    episode: null,
    changes: [{ episode: third, finished: true, updated: 400 }],
  });
  assert.equal(ended.lastPlayingEpisode, null);
  assert.deepEqual(ended.queue, { primary: [], secondary: [] });
  assert.deepEqual(ended.playbackProgress, {});
});

test('a pending native checkpoint preserves newer listening progress from Drive', () => {
  const recent = { currentTime: 40, lastUpdated: 500 };
  const state = {
    ...INITIAL_STATE, queue: { primary: [], secondary: [second] }, lastPlayingEpisode: first,
    playbackProgress: { [first.audioUrl]: recent },
  };
  const restored = applyAndroidPlayback(state, {
    episode: second,
    changes: [
      { episode: first, finished: true, updated: 300 },
      { episode: second, time: 15, duration: 60, updated: 400 },
    ],
  });

  assert.equal(restored.lastPlayingEpisode, first);
  assert.deepEqual(restored.queue, { primary: [], secondary: [second] });
  assert.equal(restored.playbackProgress[first.audioUrl], recent);
  assert.equal(restored.playbackProgress[second.audioUrl].currentTime, 15);
});

test('consumes direct selections made before the native journal reconciles', () => {
  const state = { ...INITIAL_STATE, queue: { primary: [first, third], secondary: [second] } };
  const restored = applyAndroidPlayback(state, {
    episode: second,
    changes: [
      { episode: third, time: 0, duration: 60, updated: 100, selected: true },
      { episode: second, time: 0, duration: 60, updated: 200, selected: true },
    ],
  });
  assert.equal(restored.lastPlayingEpisode, second);
  assert.deepEqual(restored.queue, { primary: [first], secondary: [] });
  assert.deepEqual(restored.playedEpisodes, {});
});

test('recently played survives a completion and ignores seek-only or older checkpoints', () => {
  const firstTrack = { ...first, podcastId: 'feed-a' };
  const secondTrack = { ...second, podcastId: 'feed-b' };
  const state = { ...INITIAL_STATE, podcastLastPlayed: { 'feed-a': 50 } };
  const seekOnly = applyAndroidPlayback(state, {
    episode: secondTrack,
    changes: [{ episode: secondTrack, time: 15, duration: 60, updated: 100, lastPlayed: 0 }],
  });
  assert.deepEqual(seekOnly.podcastLastPlayed, { 'feed-a': 50 });

  const completed = applyAndroidPlayback(seekOnly, {
    episode: null,
    changes: [
      { episode: secondTrack, finished: true, updated: 200, lastPlayed: 200 },
      { episode: firstTrack, time: 15, duration: 60, updated: 210, lastPlayed: 25 },
    ],
  });
  assert.deepEqual(completed.podcastLastPlayed, { 'feed-a': 50, 'feed-b': 200 });
  assert.equal(completed.playbackProgress[secondTrack.audioUrl], undefined);
});

test('each track carries its own podcast speed', () => {
  const overridden = { ...first, podcastId: 'feed-a' };
  const global = { ...second, podcastId: 'feed-b' };
  const state = {
    ...INITIAL_STATE, playbackSpeed: 1.5, podcastPlaybackSpeeds: { 'feed-a': 2 },
    queue: { primary: [overridden], secondary: [global, third] }, lastPlayingEpisode: global,
  };
  assert.deepEqual(androidPlaybackQueue(state).map(track => track.playbackSpeed), [2, 1.5, 1.5]);
  assert.equal(androidPlaybackOpen(state).track?.playbackSpeed, 1.5);
  assert.deepEqual(androidPlaybackQueue({ ...INITIAL_STATE, queue: { primary: [overridden], secondary: [] } })
    .map(track => track.playbackSpeed), [1]);
});
