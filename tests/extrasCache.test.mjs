import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptFor, CHAPTERS_TYPE, isPrivateExtraSource, loadEpisodeExtra, loadExtraFile, MAX_UNPINNED_FILES, pinExtras,
  pinnedUrls, preferredExtras, selectEvictions, unpinExtras, unpinExtrasExcept,
} from '../src/services/extrasCache.ts';

// Eviction only sees the metadata entries and the pin records, never the bodies.
const entry = (url, lastUsed) => ({ url, type: 'text/vtt', fetchedAt: 0, lastUsed });

test('eviction removes unpinned files beyond the limit, least recently used first', () => {
  const entries = [entry('a', 5), entry('b', 1), entry('c', 3), entry('d', 4), { url: 'e', type: 'text/vtt', fetchedAt: 2 }];
  const pins = [{ id: 'e1', urls: ['c'] }];
  assert.deepEqual(selectEvictions(entries, pins, 2), ['e', 'b']);
  assert.deepEqual(selectEvictions(entries, pins, 4), []);
  assert.deepEqual(selectEvictions(entries, pins, 0), ['a', 'd', 'e', 'b']);
  assert.deepEqual(selectEvictions([entry('y', 1), entry('x', 1)], [], 1), ['y'], 'ties break by URL');
});

test('pinned files never count toward the default limit', () => {
  const pinned = Array.from({ length: 300 }, (_, i) => entry(`p${i}`, i));
  const unpinned = Array.from({ length: MAX_UNPINNED_FILES + 2 }, (_, i) => entry(`u${i}`, i));
  const pins = [{ id: 'e1', urls: pinned.map(file => file.url) }];
  assert.deepEqual(selectEvictions([...pinned, ...unpinned], pins), ['u1', 'u0']);
});

test('accept headers only use types Android native HTTP allows', () => {
  assert.equal(acceptFor(CHAPTERS_TYPE), 'application/json');
  assert.equal(acceptFor('application/json'), 'application/json');
  assert.equal(acceptFor('text/vtt; charset=utf-8'), 'text/vtt');
  assert.equal(acceptFor('application/x-subrip'), 'application/x-subrip, application/srt');
  assert.equal(acceptFor('application/srt'), 'application/x-subrip, application/srt');
  assert.equal(acceptFor('Text/HTML'), 'text/html');
  assert.equal(acceptFor('text/plain'), 'text/plain');
  assert.equal(acceptFor('application/pdf'), undefined);
});

test('extras of private Substack feeds are private sources', () => {
  assert.equal(isPrivateExtraSource('https://author.substack.com/feed/podcast/123/private/abc.rss'), true);
  assert.equal(isPrivateExtraSource('https://author.substack.com/feed/podcast/123.rss?token=abc'), true);
  assert.equal(isPrivateExtraSource('https://author.substack.com/feed/podcast/123.rss'), false);
  assert.equal(isPrivateExtraSource('https://feed.example/show.rss'), false);
  assert.equal(isPrivateExtraSource('not a url'), false);
});

test('a file is pinned while any pin record lists it', () => {
  const a = { id: 'a', urls: ['shared', 'only-a'] };
  const b = { id: 'b', urls: ['shared', 'only-b'] };
  assert.deepEqual([...pinnedUrls([a, b])].sort(), ['only-a', 'only-b', 'shared']);
  assert.deepEqual([...pinnedUrls([a])].sort(), ['only-a', 'shared'], 'removing one pin keeps a shared URL pinned');
  assert.deepEqual(pinnedUrls([]).size, 0);
  // Removing b's record releases only-b without touching anything a lists, even before a's files are cached.
  const files = ['shared', 'only-a', 'only-b'].map((url, i) => entry(url, i));
  assert.deepEqual(selectEvictions(files, [a], 0), ['only-b']);
  assert.deepEqual(selectEvictions(files, [a, b], 0), []);
});

const episode = { id: 'e1', podcastId: 'https://feed.example/show.rss', title: 'e1', pubDate: '', audioUrl: 'https://a.example/e1.mp3', duration: 0, description: '' };

test('downloads keep the chapters and the preferred transcript', () => {
  const transcripts = [{ url: 'https://t.example/a.txt', type: 'text/plain', language: 'en' }, { url: 'https://t.example/a.vtt', type: 'text/vtt', language: 'de' }];
  assert.deepEqual(preferredExtras({ ...episode, chaptersUrl: 'https://t.example/c.json', transcripts }, 'en-GB'), [
    { url: 'https://t.example/c.json', type: CHAPTERS_TYPE },
    { url: 'https://t.example/a.txt', type: 'text/plain' },
  ]);
  assert.deepEqual(preferredExtras({ ...episode, transcripts }), [{ url: 'https://t.example/a.vtt', type: 'text/vtt' }]);
  assert.deepEqual(preferredExtras({ ...episode, transcripts: [] }), []);
});

// Node has no IndexedDB, so these cover the paths where the cache itself is unavailable.
test('loads fall back to the network and never reject when the cache is unavailable', async t => {
  t.mock.method(console, 'warn', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, init) => new Response(`body ${init.headers.Accept}`));
  assert.equal(await loadExtraFile('https://t.example/a.vtt', { type: 'text/vtt' }), 'body text/vtt');
  assert.equal(await loadEpisodeExtra(episode, { url: 'https://t.example/c.json', type: CHAPTERS_TYPE }), 'body application/json');
  fetch.mock.mockImplementation(async () => { throw new Error('offline'); });
  assert.equal(await loadExtraFile('https://t.example/a.vtt', { type: 'text/vtt' }), null);
  assert.equal(await loadExtraFile('ftp://t.example/a.vtt', { type: 'text/vtt' }), null);
});

test('private sources are fetched only from the publisher', async t => {
  t.mock.method(console, 'warn', () => {});
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => { urls.push(String(url)); throw new Error('offline'); });
  const privateEpisode = { ...episode, podcastId: 'https://author.substack.com/feed/podcast/1/private/x.rss' };
  assert.equal(await loadEpisodeExtra(privateEpisode, { url: 'https://author.substack.com/t.vtt', type: 'text/vtt' }), null);
  assert.deepEqual(urls, ['https://author.substack.com/t.vtt']);
  urls.length = 0;
  await loadEpisodeExtra(episode, { url: 'https://t.example/t.vtt', type: 'text/vtt' });
  assert.ok(urls.length > 1, 'public sources may fall back to proxies');
});

test('pinning and unpinning are best effort', async t => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  await pinExtras({ ...episode, chaptersUrl: 'https://t.example/c.json', transcripts: [] });
  await pinExtras({ ...episode, transcripts: [] });
  await unpinExtras(episode.id);
  await unpinExtrasExcept([]);
});
