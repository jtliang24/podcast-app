import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPodcastFeed } from '../src/services/podcastService.ts';
import { clearExtrasCache, resolveExtras } from '../src/services/episodeExtras.ts';

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
