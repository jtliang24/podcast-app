import assert from 'node:assert/strict';
import test from 'node:test';

// The platform is read once when the app's modules load, so the Android bridge is set up before importing them.
const requests = [];
globalThis.androidBridge = { postMessage() {} };
globalThis.Capacitor = {
  PluginHeaders: [{ name: 'PodcastHttp', methods: [{ name: 'get', rtype: 'promise' }] }],
  async nativePromise(plugin, method, options) {
    assert.equal(`${plugin}.${method}`, 'PodcastHttp.get');
    requests.push(options);
    return { status: 200, body: options.url.endsWith('.rss') ? xml : '{"chapters":[]}' };
  },
};
const { fetchPodcastFeed, fetchRemoteText, PrivateFeedError } = await import('../src/services/podcastService.ts');

const feed = 'https://api.substack.com/feed/podcast/12/s/34/private/sample.rss';
const xml = `<rss version="2.0"><channel><title>Private show</title><item>
  <title>Subscriber episode</title><guid isPermaLink="false">123</guid>
</item></channel></rss>`;

test('only private feeds ask native HTTP for its private-feed mode', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected web request'); });
  requests.length = 0;
  await fetchPodcastFeed(feed);
  assert.deepEqual(requests.map(({ url, privateFeed }) => ({ url, privateFeed })), [{ url: feed, privateFeed: true }]);

  // Private chapters and transcripts live outside the feed path, so they go direct without the feed checks.
  requests.length = 0;
  const chapters = 'https://cdn.example/episodes/1/chapters.json';
  assert.equal(await fetchRemoteText(chapters, { privateSource: true, accept: 'application/json' }), '{"chapters":[]}');
  assert.deepEqual(requests, [{ url: chapters, privateFeed: false, accept: 'application/json' }]);
  await assert.rejects(fetchRemoteText('http://cdn.example/t.vtt', { privateSource: true }), PrivateFeedError);
  assert.equal(requests.length, 1);
});
