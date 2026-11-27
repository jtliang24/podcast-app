import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPodcastFeed, fetchRemoteText, MAX_REMOTE_TEXT_BYTES, readCappedText } from '../src/services/podcastService.ts';
import { clearExtrasCache, lookupExtras, resolveExtras } from '../src/services/episodeExtras.ts';

const feedUrl = 'https://feed.example/show.rss';
const feedXml = items => `<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:psc="http://podlove.org/simple-chapters"><channel><title>Show</title>${items}</channel></rss>`;
const item = (guid, body) => `<item><title>${guid}</title><guid>${guid}</guid><enclosure url="https://a.example/${guid}.mp3"/>${body}</item>`;

async function parse(items, t) {
  t.mock.method(globalThis, 'fetch', async () => new Response(feedXml(items)));
  return (await fetchPodcastFeed(feedUrl)).episodes;
}

test('a single transcript and chapters url are parsed', async t => {
  const [ep] = await parse(item('one', `<podcast:transcript url="https://t.example/one.vtt" type="text/vtt" language="en" rel="captions"/>
    <podcast:chapters url="https://t.example/one.json" type="application/json+chapters"/>`), t);
  assert.deepEqual(ep.transcripts, [{ url: 'https://t.example/one.vtt', type: 'text/vtt', language: 'en', rel: 'captions' }]);
  assert.equal(ep.chaptersUrl, 'https://t.example/one.json');
  assert.equal(ep.inlineChapters, undefined);
});

test('several transcripts are parsed and episodes without any get an empty list', async t => {
  const [many, none] = await parse(item('many', `<podcast:transcript url="https://t.example/a.srt" type="application/x-subrip"/>
    <podcast:transcript url="https://t.example/a.html" type="text/html" language="fr"/>`) + item('none', ''), t);
  assert.deepEqual(many.transcripts, [
    { url: 'https://t.example/a.srt', type: 'application/x-subrip' },
    { url: 'https://t.example/a.html', type: 'text/html', language: 'fr' },
  ]);
  assert.deepEqual(none.transcripts, []);
  assert.equal(none.chaptersUrl, undefined);
});

test('PSC chapters accept several time formats and drop invalid starts', async t => {
  const [ep] = await parse(item('psc', `<psc:chapters version="1.2">
    <psc:chapter start="00:00:00.000" title="Intro"/>
    <psc:chapter start="01:02:03.500" title="Long" href="https://x.example/p" image="https://x.example/i.png"/>
    <psc:chapter start="02:30" title="Mins" href="http://x.example/insecure"/>
    <psc:chapter start="45" title="Secs"/>
    <psc:chapter start="12.5" title="Fraction"/>
    <psc:chapter start="soon" title="Bad"/>
    <psc:chapter title="Missing"/>
  </psc:chapters>`), t);
  assert.deepEqual(ep.inlineChapters, [
    { start: 0, title: 'Intro' },
    { start: 12.5, title: 'Fraction' },
    { start: 45, title: 'Secs' },
    { start: 150, title: 'Mins' },
    { start: 3723.5, title: 'Long', url: 'https://x.example/p', img: 'https://x.example/i.png' },
  ]);
});

test('a single PSC chapter and the 100 chapter cap are handled', async t => {
  const [one] = await parse(item('one', '<psc:chapters><psc:chapter start="5" title="Only"/></psc:chapters>'), t);
  assert.deepEqual(one.inlineChapters, [{ start: 5, title: 'Only' }]);
  const many = Array.from({ length: 150 }, (_, i) => `<psc:chapter start="${i}" title="c${i}"/>`).join('');
  const [capped] = await parse(item('many', `<psc:chapters>${many}</psc:chapters>`), t);
  assert.equal(capped.inlineChapters.length, 100);
});

test('non-HTTPS and invalid URLs are rejected', async t => {
  const [ep] = await parse(item('bad', `<podcast:transcript url="http://t.example/a.vtt" type="text/vtt"/>
    <podcast:transcript url="not a url" type="text/vtt"/>
    <podcast:transcript url="javascript:alert(1)" type="text/html"/>
    <podcast:transcript type="text/vtt"/>
    <podcast:transcript url="https://t.example/ok.vtt" type="text/vtt"/>
    <podcast:chapters url="http://t.example/c.json"/>`), t);
  assert.deepEqual(ep.transcripts.map(entry => entry.url), ['https://t.example/ok.vtt']);
  assert.equal(ep.chaptersUrl, undefined);
});

const oldEpisode = { id: 'one', podcastId: feedUrl, title: 'one', pubDate: '', audioUrl: 'https://a.example/one.mp3', duration: 0, description: '' };

test('an old episode is detected as missing extras and filled from the feed once', async t => {
  clearExtrasCache();
  const calls = t.mock.method(globalThis, 'fetch', async () => new Response(feedXml(
    item('one', '<podcast:transcript url="https://t.example/one.vtt" type="text/vtt"/><podcast:chapters url="https://t.example/c.json"/>'))));
  const resolved = await resolveExtras(oldEpisode);
  assert.equal(oldEpisode.transcripts, undefined);
  assert.equal(resolved.transcripts.length, 1);
  assert.equal(resolved.chaptersUrl, 'https://t.example/c.json');
  assert.equal(resolved.title, 'one');
  await resolveExtras({ ...oldEpisode });
  assert.equal(calls.mock.callCount(), 1);

  const current = { ...oldEpisode, transcripts: [] };
  assert.equal(await resolveExtras(current), current);
  assert.equal(calls.mock.callCount(), 1);
});

test('failed fetches are retried and missing episodes resolve to no extras', async t => {
  clearExtrasCache();
  let fail = true;
  const fetcher = async () => {
    if (fail) throw new Error('offline');
    return { podcast: {}, episodes: [] };
  };
  assert.deepEqual((await resolveExtras(oldEpisode, fetcher)).transcripts, []);
  fail = false;
  let calls = 0;
  const counting = async () => { calls++; return fetcher(); };
  assert.deepEqual((await resolveExtras(oldEpisode, counting)).transcripts, []);
  await resolveExtras(oldEpisode, counting);
  assert.equal(calls, 1);
});

test('extras kept for a downloaded old episode are used before the feed, so they work offline', async t => {
  clearExtrasCache();
  const kept = { chaptersUrl: 'https://t.example/c.json', inlineChapters: undefined, transcripts: [{ url: 'https://t.example/one.vtt', type: 'text/vtt' }] };
  const offline = t.mock.fn(async () => { throw new Error('offline'); });
  const stored = t.mock.fn(async id => id === 'one' ? kept : undefined);
  const resolved = await resolveExtras(oldEpisode, offline, stored);
  assert.deepEqual(resolved.transcripts, kept.transcripts);
  assert.equal(resolved.chaptersUrl, kept.chaptersUrl);
  assert.equal(offline.mock.callCount(), 0);
  assert.deepEqual(await lookupExtras(oldEpisode, offline, stored), kept);

  assert.deepEqual((await resolveExtras({ ...oldEpisode, id: 'other' }, offline, stored)).transcripts, []);
  assert.equal(offline.mock.callCount(), 1, 'without kept extras the feed is fetched');
  assert.equal(await lookupExtras({ ...oldEpisode, id: 'other' }, offline, stored), undefined);
  const broken = async () => { throw new Error('no IndexedDB'); };
  const feed = async () => ({ podcast: {}, episodes: [{ ...oldEpisode, transcripts: kept.transcripts }] });
  assert.deepEqual((await resolveExtras(oldEpisode, feed, broken)).transcripts, kept.transcripts);
});

const MiB = 1024 * 1024;

/** A body of `chunks` 1 MiB chunks with no Content-Length, counting the chunks actually pulled. */
function streamedBody(chunks) {
  const stats = { pulled: 0 };
  const chunk = new Uint8Array(MiB).fill(0x61);
  const body = new ReadableStream({
    pull(controller) {
      if (stats.pulled === chunks) return controller.close();
      stats.pulled++;
      controller.enqueue(chunk);
    },
  });
  return { body, stats };
}

test('capped reads decode UTF-8 across chunks and reject bodies over the cap', async () => {
  const bytes = new TextEncoder().encode('WEBVTT é ü');
  const split = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 8));
      controller.enqueue(bytes.slice(8));
      controller.close();
    },
  });
  assert.equal(await readCappedText(new Response(split), bytes.length), 'WEBVTT é ü');
  assert.equal(await readCappedText(new Response(null), 10), '');
  await assert.rejects(readCappedText(new Response('x'.repeat(11)), 10), /larger than 10 bytes/);
  await assert.rejects(readCappedText(new Response('x', { headers: { 'Content-Length': '11' } }), 10), /larger than 10 bytes/);
});

test('remote extras larger than the cap fail like other sources and stop reading', async t => {
  const file = 'https://t.example/huge.vtt';
  const declared = String(MAX_REMOTE_TEXT_BYTES + 1);
  t.mock.method(globalThis, 'fetch', async url => url === file
    ? new Response('WEBVTT', { headers: { 'Content-Length': declared } })
    : new Response('WEBVTT proxy'));
  assert.equal(await fetchRemoteText(file, { accept: 'text/vtt' }), 'WEBVTT proxy', 'an oversized source falls through');

  const streams = [];
  t.mock.method(globalThis, 'fetch', async () => {
    const streamed = streamedBody(MAX_REMOTE_TEXT_BYTES / MiB + 4);
    streams.push(streamed.stats);
    return new Response(streamed.body);
  });
  await assert.rejects(fetchRemoteText(file, { privateSource: true }), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.errors[0].message, /^Publisher: Response is larger than/);
    return true;
  });
  assert.equal(streams.length, 1);
  assert.ok(streams[0].pulled <= MAX_REMOTE_TEXT_BYTES / MiB + 2, 'reading stops past the cap');

  t.mock.method(globalThis, 'fetch', async () => {
    const streamed = streamedBody(2);
    return new Response(streamed.body);
  });
  assert.equal((await fetchRemoteText(file)).length, 2 * MiB);
});

test('feeds are not capped', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(feedXml(item('one', '')), {
    headers: { 'Content-Length': String(MAX_REMOTE_TEXT_BYTES + 1) },
  }));
  assert.equal((await fetchPodcastFeed(feedUrl)).episodes.length, 1);
});
