import assert from 'node:assert/strict';
import test from 'node:test';
import { nextEpisode, moveQueuedEpisode, normalizeState, orderedQueue, queueEpisode, removeQueuedEpisode } from '../src/services/playbackQueue.ts';
import { applyBatch, newProfile, recordEdit, seedProfile } from '../src/services/profileChanges.ts';

const episode = id => ({ id, title: id, audioUrl: `https://example.org/${id}.mp3` });
const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(episode);

test('queue actions move existing entries to the requested tier and position', () => {
  let queue = { primary: [a, b], secondary: [c, d] };
  queue = queueEpisode(queue, d, 'play-next');
  assert.deepEqual(queue, { primary: [d, a, b], secondary: [c] });
  queue = queueEpisode(queue, a, 'play-up-next');
  assert.deepEqual(queue, { primary: [d, b, a], secondary: [c] });
  queue = queueEpisode(queue, b, 'add-to-queue');
  assert.deepEqual(queue, { primary: [d, a], secondary: [c, b] });
  assert.equal(queueEpisode(queue, b, 'add-to-queue'), queue);
  queue = queueEpisode(queue, c, 'add-to-queue');
  assert.deepEqual(queue.secondary, [b, c]);
});

test('reorders and moves between tiers, including into an empty tier', () => {
  let queue = { primary: [a, b], secondary: [c, d] };
  queue = moveQueuedEpisode(queue, b.id, 'primary', a.id);
  queue = moveQueuedEpisode(queue, d.id, 'primary', a.id);
  assert.deepEqual(queue, { primary: [b, d, a], secondary: [c] });
  queue = moveQueuedEpisode(queue, c.id, 'primary');
  queue = moveQueuedEpisode(queue, d.id, 'secondary');
  assert.deepEqual(queue, { primary: [b, a, c], secondary: [d] });
  assert.equal(moveQueuedEpisode(queue, d.id, 'secondary', d.id), queue);
});

test('direct playback consumes only the selected episode and every handoff reevaluates priority', () => {
  let queue = { primary: [], secondary: [a, b, c] };
  assert.equal(nextEpisode(queue), a);
  queue = removeQueuedEpisode(queue, b.id);
  assert.deepEqual(orderedQueue(queue), [a, c]);
  queue = queueEpisode(queue, d, 'play-up-next');
  queue = queueEpisode(queue, e, 'play-next');
  assert.deepEqual(orderedQueue(queue), [e, d, a, c]);
  for (const expected of [e, d, a, c]) {
    assert.equal(nextEpisode(queue), expected);
    queue = removeQueuedEpisode(queue, expected.id);
  }
  assert.equal(nextEpisode(queue), null);
});

test('legacy snapshots keep the saved current episode and migrate waiting entries in order', () => {
  const snapshot = { lastPlayingEpisode: b, queue: [a, b, c] };
  for (const restored of [normalizeState(snapshot), seedProfile(newProfile(), snapshot).state]) {
    assert.deepEqual(restored.lastPlayingEpisode, b);
    assert.deepEqual(restored.queue, { primary: [], secondary: [a, c] });
  }
  assert.deepEqual(normalizeState({ queue: [b, a] }).queue, { primary: [], secondary: [b, a] });
});

test('queue edits sync as one ordered value and survive JSON export and import', () => {
  const first = newProfile();
  const queue = { primary: [b, a], secondary: [d, c] };
  recordEdit(first, state => ({ ...state, queue }), 'phone', false, 100);
  const { batch } = first.pending[0];
  assert.deepEqual(batch.changes, [{ field: 'queue', value: queue }]);

  const second = newProfile();
  applyBatch(second, JSON.parse(JSON.stringify(batch)));
  applyBatch(second, { id: 'older', time: 99, device: 'desktop', changes: [{ field: 'queue', value: [c, b] }] });
  assert.deepEqual(second.state.queue, queue);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(second.state))).queue, queue);
});

test('legacy Drive changes can resolve the restored episode from the queue', () => {
  const profile = newProfile();
  applyBatch(profile, { id: 'queue', time: 100, device: 'phone', changes: [{ field: 'queue', value: [a, b, c] }] });
  applyBatch(profile, { id: 'session', time: 101, device: 'phone', changes: [{ field: 'sessionUrl', value: b.audioUrl }] });
  assert.deepEqual(profile.state.lastPlayingEpisode, b);
  assert.deepEqual(profile.state.queue, { primary: [], secondary: [a, c] });
});

test('a newer queue can re-add a previous episode before the new session arrives', () => {
  const profile = newProfile({ lastPlayingEpisode: a });
  const queue = { primary: [a, c], secondary: [d] };
  applyBatch(profile, { id: 'queue', time: 102, device: 'phone', changes: [{ field: 'queue', value: queue }] });
  applyBatch(profile, { id: 'session', time: 101, device: 'phone', changes: [{ field: 'lastPlayingEpisode', value: b }] });
  assert.deepEqual(profile.state.lastPlayingEpisode, b);
  assert.deepEqual(profile.state.queue, queue);
});
