import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPodcastFeed, PrivateFeedError } from '../src/services/podcastService.ts';
import { substackFeedEndpoint, substackFeedHeader } from '../src/services/substackFeed.ts';
import { substackFeedPlugin } from '../server/substackFeed.ts';

const feed = 'https://api.substack.com/feed/podcast/12/s/34/private/sample.rss?sig=a%2Fb+c&part=2';
const xml = `<rss version="2.0"><channel><title>Private show</title><item>
  <title>Subscriber episode</title><guid isPermaLink="false">123</guid>
  <enclosure url="https://audio.example/one.mp3?a=1&amp;b=2" type="audio/mpeg"/>
</item></channel></rss>`;

test('a private feed blocked by browser CORS loads through the app with its original token', async t => {
  const calls = t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === feed) throw new TypeError('Failed to fetch');
    assert.equal(url, substackFeedEndpoint);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers[substackFeedHeader], feed);
    return new Response(xml);
  });
  const { podcast, episodes } = await fetchPodcastFeed(feed);
  assert.equal(calls.mock.callCount(), 2);
  assert.equal(podcast.feedUrl, feed);
  assert.equal(episodes[0].podcastId, feed);
  assert.equal(episodes[0].audioUrl, 'https://audio.example/one.mp3?a=1&b=2');
});

test('denied access produces guidance without sharing the token with a public proxy', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    return new Response(null, { status: 403 });
  });
  await assert.rejects(fetchPodcastFeed(feed), err => err instanceof PrivateFeedError
    && err.message.includes('subscription settings') && !err.message.includes(feed));
  assert.deepEqual(calls, [feed, substackFeedEndpoint]);
});

test('public feeds can still load through the public fallback', async t => {
  const publicFeed = 'https://api.substack.com/feed/podcast/12.rss';
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    if (url === publicFeed) throw new TypeError('Failed to fetch');
    return new Response(xml);
  });
  await fetchPodcastFeed(publicFeed);
  assert.deepEqual(calls, [publicFeed, 'https://api.allorigins.win/raw?url=' + encodeURIComponent(publicFeed)]);
});

test('a Substack setup page prompts for the RSS link without sending the URL anywhere', async t => {
  const calls = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected request'); });
  await assert.rejects(fetchPodcastFeed('https://example.substack.com/account/add-podcast?token=sample'), /copy the private RSS feed URL/);
  assert.equal(calls.mock.callCount(), 0);
});

test('the relay checks the destination before following a redirect', async t => {
  let handle;
  substackFeedPlugin.configurePreviewServer({
    middlewares: { use(path, middleware) { assert.equal(path, substackFeedEndpoint); handle = middleware; } },
  });
  const calls = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url.href, feed);
    assert.equal(init.redirect, 'manual');
    return Response.redirect('https://example.org/feed');
  });
  const res = { setHeader() {}, writeHead(status) { this.status = status; return this; }, end() {} };
  await handle({ method: 'POST', headers: { [substackFeedHeader]: feed } }, res);
  assert.equal(calls.mock.callCount(), 1);
  assert.equal(res.status, 502);
});
