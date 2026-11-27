import assert from 'node:assert/strict';
import test from 'node:test';
import {
  artworkAt, chapterAt, chapterPosition, chapterTitle, fromInlineChapters, parseJsonChapters, tocChapters,
} from '../src/services/chapters.ts';

const json = (chapters, extra = {}) => JSON.stringify({ version: '1.2.0', chapters, ...extra });

test('invalid files give no chapters', () => {
  assert.deepEqual(parseJsonChapters('not json'), []);
  assert.deepEqual(parseJsonChapters(''), []);
  assert.deepEqual(parseJsonChapters('null'), []);
  assert.deepEqual(parseJsonChapters('[{"startTime":0}]'), []);
  assert.deepEqual(parseJsonChapters(json({ startTime: 0 })), []);
  assert.deepEqual(parseJsonChapters('{"version":"1.2.0"}'), []);
});

test('entries without a valid start are skipped and the rest are sorted', () => {
  const chapters = parseJsonChapters(json([
    { startTime: 120, title: 'Third' },
    { startTime: 'soon', title: 'Bad start' },
    { startTime: -5, title: 'Negative' },
    { title: 'No start' },
    { startTime: null, title: 'Null' },
    'not an object',
    null,
    { startTime: 0, title: '  First  ' },
    { startTime: '60.5', title: 'Second' },
  ]), 300);
  assert.deepEqual(chapters.map(({ start, title }) => [start, title]), [[0, 'First'], [60.5, 'Second'], [120, 'Third']]);
});

test('end times come from the next start, then the duration', () => {
  const file = json([{ startTime: 0, title: 'A' }, { startTime: 30, title: 'B' }, { startTime: 90, title: 'C' }]);
  assert.deepEqual(parseJsonChapters(file, 200).map(chapter => chapter.end), [30, 90, 200]);
  assert.deepEqual(parseJsonChapters(file).map(chapter => chapter.end), [30, 90, Infinity], 'duration unknown');
  assert.deepEqual(parseJsonChapters(file, 0).map(chapter => chapter.end), [30, 90, Infinity]);
  assert.deepEqual(parseJsonChapters(file, 60).map(chapter => chapter.end), [30, 90, Infinity], 'duration before the last start');
});

test('a declared end time is kept only when it is after the start and before the next one', () => {
  const chapters = parseJsonChapters(json([
    { startTime: 0, endTime: 20, title: 'Ends early' },
    { startTime: 30, endTime: 500, title: 'Overlaps' },
    { startTime: 60, endTime: 50, title: 'Ends before it starts' },
    { startTime: 90, endTime: 150, title: 'Last' },
  ]), 200);
  assert.deepEqual(chapters.map(chapter => chapter.end), [20, 60, 90, 150]);
  assert.equal(parseJsonChapters(json([{ startTime: 10, endTime: 40 }])).at(0).end, 40, 'used without a duration');
  assert.equal(parseJsonChapters(json([{ startTime: 10, endTime: 400 }]), 300).at(0).end, 300, 'capped by the duration');
});

test('only https links and images are kept, and toc defaults to true', () => {
  const [first, second] = parseJsonChapters(json([
    { startTime: 0, title: 'A', url: 'https://example.com/a', img: 'https://example.com/a.jpg' },
    { startTime: 10, title: 'B', url: 'http://example.com/b', img: 'javascript:alert(1)', toc: true },
  ]));
  assert.equal(first.url, 'https://example.com/a');
  assert.equal(first.img, 'https://example.com/a.jpg');
  assert.equal(first.toc, true);
  assert.equal('url' in second, false);
  assert.equal('img' in second, false);
  assert.equal(parseJsonChapters(json([{ startTime: 0, url: '/relative' }]))[0].url, undefined);
  assert.equal(parseJsonChapters(json([{ startTime: 0, title: 42 }]))[0].title, '');
});

test('toc: false chapters are left out of the list but count for artwork', () => {
  const all = parseJsonChapters(json([
    { startTime: 0, title: 'Intro', img: 'https://example.com/intro.jpg' },
    { startTime: 20, title: 'Slide', img: 'https://example.com/slide.jpg', toc: false, endTime: 40 },
    { startTime: 50, title: 'Slide two', img: 'https://example.com/two.jpg', toc: false },
    { startTime: 100, title: 'Main' },
  ]), 300);
  const toc = tocChapters(all);
  assert.deepEqual(toc.map(chapter => chapter.title), ['Intro', 'Main']);
  assert.equal(toc[0].end, 100, 'a toc: false chapter does not cut its toc chapter short');
  assert.equal(all[2].end, 100, 'a toc: false chapter ends at the next chapter of either kind');

  assert.equal(chapterAt(toc, 30).title, 'Intro');
  assert.equal(artworkAt(all, 10).img, 'https://example.com/intro.jpg');
  assert.equal(artworkAt(all, 30).img, 'https://example.com/slide.jpg');
  assert.equal(artworkAt(all, 45).img, 'https://example.com/intro.jpg', 'back to the chapter image after the slide ends');
  assert.equal(artworkAt(all, 60).img, 'https://example.com/two.jpg');
  assert.equal(artworkAt(all, 150), undefined, 'Main has no image');
});

test('chapterAt finds the chapter at the edges', () => {
  const chapters = parseJsonChapters(json([{ startTime: 10, title: 'A' }, { startTime: 30, title: 'B' }, { startTime: 60, title: 'C' }]), 90);
  assert.equal(chapterAt(chapters, 0), undefined, 'before the first start');
  assert.equal(chapterAt(chapters, 9.9), undefined);
  assert.equal(chapterAt(chapters, 10).title, 'A', 'exactly at the first start');
  assert.equal(chapterAt(chapters, 29.9).title, 'A');
  assert.equal(chapterAt(chapters, 30).title, 'B', 'a boundary belongs to the chapter that starts there');
  assert.equal(chapterAt(chapters, 89.9).title, 'C');
  assert.equal(chapterAt(chapters, 90), undefined, 'at the end');
  assert.equal(chapterAt(chapters, 1000), undefined, 'after the last');
  assert.equal(chapterAt([], 5), undefined);

  const gap = parseJsonChapters(json([{ startTime: 0, endTime: 10, title: 'A' }, { startTime: 20, title: 'B' }]));
  assert.equal(chapterAt(gap, 15), undefined, 'in a gap left by a declared end');
  assert.equal(chapterAt(gap, 1e6).title, 'B', 'the last chapter lasts until the end when the duration is unknown');
});

test('chapterPosition gives next and previous, restarting a chapter after 3 seconds', () => {
  const toc = parseJsonChapters(json([{ startTime: 10, title: 'A' }, { startTime: 30, title: 'B' }, { startTime: 60, endTime: 70, title: 'C' }]), 90);
  const titles = time => {
    const { current, next, previous } = chapterPosition(toc, time);
    return [current?.title, next?.title, previous?.title];
  };
  assert.deepEqual(titles(0), [undefined, 'A', undefined]);
  assert.deepEqual(titles(11), ['A', 'B', undefined]);
  assert.deepEqual(titles(14), ['A', 'B', 'A']);
  assert.deepEqual(titles(32), ['B', 'C', 'A']);
  assert.deepEqual(titles(33), ['B', 'C', 'A'], 'exactly 3 seconds in still goes back');
  assert.deepEqual(titles(33.5), ['B', 'C', 'B']);
  assert.deepEqual(titles(80), [undefined, undefined, 'C'], 'after the last chapter ended');
});

test('fromInlineChapters converts Podlove chapters', () => {
  const episode = {
    inlineChapters: [
      { start: 95.5, title: 'Second', url: 'https://example.com/2', img: 'http://example.com/2.jpg' },
      { start: 0, title: 'First', img: 'https://example.com/1.jpg' },
    ],
  };
  assert.deepEqual(fromInlineChapters(episode, 300), [
    { start: 0, end: 95.5, title: 'First', toc: true, img: 'https://example.com/1.jpg' },
    { start: 95.5, end: 300, title: 'Second', toc: true, url: 'https://example.com/2' },
  ]);
  assert.equal(fromInlineChapters(episode).at(-1).end, Infinity);
  assert.deepEqual(fromInlineChapters({}), []);
  assert.deepEqual(fromInlineChapters({ inlineChapters: [] }), []);
});

test('chapterTitle numbers untitled chapters', () => {
  const [untitled, titled] = parseJsonChapters(json([{ startTime: 0 }, { startTime: 5, title: 'Named' }]));
  assert.equal(chapterTitle(untitled, 0), 'Chapter 1');
  assert.equal(chapterTitle(titled, 1), 'Named');
});
