import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBatch, newProfile, recordEdit } from '../src/services/profileChanges.ts';
import { latestEpisodeRelease, sortSubscriptions } from '../src/services/subscriptionSort.ts';

const podcasts = [
  { feedUrl: 'legacy', title: 'Delta' },
  { feedUrl: 'b', title: 'beta', addedAt: 3 },
  { feedUrl: 'c', title: 'Charlie', addedAt: 1 },
  { feedUrl: 'a', title: 'Alpha', addedAt: 2 },
];

test('sorts all four subscription fields in both directions with unknown dates last', () => {
  const releaseDates = { a: Date.parse('2024-01-03'), b: Date.parse('2024-01-01'), legacy: null };
  const cachedEpisodes = [
    { podcastId: 'c', pubDate: '2024-01-02' },
    { podcastId: 'c', pubDate: 'invalid' },
    { podcastId: 'legacy', pubDate: '2024-01-04' },
  ];
  const lastPlayed = { a: 1, b: 2 };
  const sort = (field, direction) =>
    sortSubscriptions(podcasts, field, direction, releaseDates, lastPlayed, cachedEpisodes).map(p => p.feedUrl);

  assert.deepEqual(sort('release-date', 'ascending'), ['b', 'c', 'a', 'legacy']);
  assert.deepEqual(sort('release-date', 'descending'), ['a', 'c', 'b', 'legacy']);
  assert.deepEqual(sort('title', 'ascending'), ['a', 'b', 'c', 'legacy']);
  assert.deepEqual(sort('title', 'descending'), ['legacy', 'c', 'b', 'a']);
  assert.deepEqual(sort('date-added', 'ascending'), ['c', 'a', 'b', 'legacy']);
  assert.deepEqual(sort('date-added', 'descending'), ['b', 'a', 'c', 'legacy']);
  assert.deepEqual(sort('recently-played', 'ascending'), ['a', 'b', 'c', 'legacy']);
  assert.deepEqual(sort('recently-played', 'descending'), ['b', 'a', 'c', 'legacy']);
  assert.deepEqual(podcasts.map(p => p.feedUrl), ['legacy', 'b', 'c', 'a']);
});

test('finds the newest valid date even if the feed is out of order', () => {
  assert.equal(latestEpisodeRelease(['2024-02-01', 'invalid', '2025-01-01', '2024-09-01']
    .map(pubDate => ({ pubDate }))), Date.parse('2025-01-01'));
  assert.equal(latestEpisodeRelease([{ pubDate: '' }]), null);
});

test('syncs sort preferences and per-feed dates from a legacy library', () => {
  const legacy = { subscriptions: podcasts };
  const phone = newProfile(legacy);
  const desktop = newProfile(legacy);
  recordEdit(phone, state => ({
    ...state,
    subscriptionSortField: 'recently-played',
    podcastLastPlayed: { a: 3 },
  }), 'phone');
  recordEdit(desktop, state => ({
    ...state,
    subscriptionSortDirection: 'ascending',
    podcastReleaseDates: { a: 1, b: null },
  }), 'desktop');

  applyBatch(phone, JSON.parse(JSON.stringify(desktop.pending[0].batch)));
  applyBatch(desktop, JSON.parse(JSON.stringify(phone.pending[0].batch)));
  assert.deepEqual(phone.state, desktop.state);
  assert.equal(phone.state.subscriptionSortField, 'recently-played');
  assert.equal(phone.state.subscriptionSortDirection, 'ascending');
  assert.deepEqual(phone.state.podcastReleaseDates, { a: 1, b: null });
  assert.deepEqual(phone.state.podcastLastPlayed, { a: 3 });
});
