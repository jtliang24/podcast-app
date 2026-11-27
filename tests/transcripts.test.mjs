import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeParagraph, decodeEntities, findMatches, groupSegments, MAX_CUE_LINE_LENGTH, parseHtmlTranscript, parseTimestamp,
  parseTranscript, pickTranscript, transcriptFormat, transcriptParagraphs, TRANSCRIPT_HTML_CONFIG,
} from '../src/services/transcripts.ts';

const ref = (type, language) => ({ url: `https://t.example/${type.replace(/\W/g, '')}-${language ?? 'none'}`, type, ...(language ? { language } : {}) });

test('pickTranscript prefers formats in order and ignores unknown ones', () => {
  const order = ['text/plain', 'text/html', 'application/json', 'application/srt', 'application/x-subrip', 'text/vtt'].map(type => ref(type));
  assert.equal(pickTranscript(order).type, 'text/vtt');
  assert.equal(pickTranscript(order.slice(0, 5)).type, 'application/srt', 'SRT types tie, so feed order wins');
  assert.equal(pickTranscript(order.slice(0, 3)).type, 'application/json');
  assert.equal(pickTranscript(order.slice(0, 2)).type, 'text/html');
  assert.equal(pickTranscript([ref('application/pdf'), ref('text/plain')]).type, 'text/plain');
  assert.equal(pickTranscript([ref('application/pdf')]), undefined);
  assert.equal(pickTranscript([]), undefined);
  assert.equal(pickTranscript(undefined), undefined);
});

test('pickTranscript prefers the reader language before format', () => {
  const list = [ref('text/vtt', 'fr'), ref('text/plain', 'en'), ref('text/html')];
  assert.equal(pickTranscript(list, 'en-US').type, 'text/plain');
  assert.equal(pickTranscript(list, 'FR').type, 'text/vtt');
  assert.equal(pickTranscript(list, 'de').type, 'text/vtt');
  assert.equal(pickTranscript(list).type, 'text/vtt');
});

test('transcript types are normalized', () => {
  assert.equal(transcriptFormat(' Text/VTT; charset=utf-8'), 'text/vtt');
  assert.equal(pickTranscript([ref('text/plain'), ref('TEXT/VTT; charset=UTF-8')]).type, 'TEXT/VTT; charset=UTF-8');
});

test('timestamps with and without hours, and with a comma', () => {
  assert.equal(parseTimestamp('01:02:03.500'), 3723.5);
  assert.equal(parseTimestamp('02:03.250'), 123.25);
  assert.equal(parseTimestamp('00:00:01,200'), 1.2);
  assert.equal(parseTimestamp('1:05'), 65);
  assert.equal(parseTimestamp('soon'), undefined);
});

test('entities are decoded as text', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &lt;3 &gt; &nbsp;it&#39;s &#x27;ok&#x27; &quot;x&quot; &bogus;'), 'Tom & Jerry <3 >  it\'s \'ok\' "x" &bogus;');
  assert.equal(decodeEntities('&#0;&#xD800;'), '\ufffd\ufffd');
});

test('WebVTT skips the header, blocks, ids and settings, and reads voices', () => {
  const vtt = [
    'WEBVTT - Episode 1',
    'Kind: captions',
    '',
    'NOTE This is a comment',
    'spanning two lines',
    '',
    'STYLE',
    '::cue { color: yellow }',
    '',
    'REGION',
    'id:fred width:40%',
    '',
    'intro-1',
    '00:00:01.000 --> 00:00:04.000 align:start position:10% line:0',
    '<v Alice Smith>Hello &amp; <b>welcome</b></v>',
    '',
    '00:04.500 --> 00:06.000',
    '<v.loud Bob>Hi <c.yellow>there</c> <00:05.000>friends &lt;3',
    'second line',
    '',
    '00:00:06.000 --> 00:00:08.000',
    '<v Alice Smith>Question?',
    '<v Bob>Answer.',
    '',
    '00:00:09.000 --> 00:00:10.000',
    'No voice here',
    '',
    '00:00:10.000 --> 00:00:11.000',
    '<i></i>',
  ].join('\n');
  assert.deepEqual(parseTranscript(vtt, 'text/vtt'), [
    { start: 1, end: 4, speaker: 'Alice Smith', text: 'Hello & welcome' },
    { start: 4.5, end: 6, speaker: 'Bob', text: 'Hi there friends <3 second line' },
    { start: 6, end: 8, speaker: 'Alice Smith', text: 'Question?' },
    { start: 6, end: 8, speaker: 'Bob', text: 'Answer.' },
    { start: 9, end: 10, text: 'No voice here' },
  ]);
});

test('SRT with CRLF line endings and comma decimals', () => {
  const srt = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>First</i> line\r\nwraps\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000 X1:10 X2:20\r\n{\\an8}Second\r\n\r\n';
  assert.deepEqual(parseTranscript(srt, 'application/x-subrip'), [
    { start: 1, end: 2.5, text: 'First line wraps' },
    { start: 3, end: 4, text: 'Second' },
  ]);
  assert.deepEqual(parseTranscript(srt, 'application/srt').length, 2);
});

test('Podcasting 2.0 JSON segments', () => {
  const json = JSON.stringify({
    version: '1.0.0',
    segments: [
      { speaker: 'Bob', startTime: 3, endTime: 4, body: 'Later' },
      { speaker: 'Alice', startTime: '0.5', endTime: 2, body: '  Hello   world ' },
      { startTime: 2, endTime: 1, body: 'Bad end' },
      { startTime: 'soon', body: 'No start' },
      { startTime: 5, body: '' },
      null,
    ],
  });
  assert.deepEqual(parseTranscript(json, 'application/json'), [
    { start: 0.5, end: 2, speaker: 'Alice', text: 'Hello world' },
    { start: 2, text: 'Bad end' },
    { start: 3, end: 4, speaker: 'Bob', text: 'Later' },
  ]);
  assert.deepEqual(parseTranscript('not json', 'application/json'), []);
  assert.deepEqual(parseTranscript('{"segments":5}', 'application/json'), []);
});

test('the HTML sanitizer config is a strict allowlist', () => {
  assert.deepEqual(TRANSCRIPT_HTML_CONFIG.ALLOWED_TAGS, ['p', 'br', 'strong', 'em', 'cite', 'time', 'span']);
  assert.deepEqual(TRANSCRIPT_HTML_CONFIG.ALLOWED_ATTR, ['datetime']);
});

test('HTML is sanitized first and then reduced to text', () => {
  const seen = [];
  const sanitize = html => {
    seen.push(html);
    return '<p>Clean</p>';
  };
  assert.deepEqual(parseHtmlTranscript('<p onclick="x()">Dirty</p>', sanitize), [{ text: 'Clean' }]);
  assert.deepEqual(seen, ['<p onclick="x()">Dirty</p>']);
  assert.deepEqual(parseTranscript('<p>Dirty</p>', 'text/html', () => '<p>Clean</p>'), [{ text: 'Clean' }]);
});

test('unsafe HTML never reaches the text, even without a sanitizer', () => {
  const html = [
    '<script>alert("x")</script><style>p { color: red }</style>',
    '<p onclick="steal()" style="x">Hello <a href="javascript:alert(1)">link text</a> <img src=x onerror="alert(1)"></p>',
    '<!-- secret --><iframe src="https://evil.example"><p>inside</p></iframe>',
    '<p>Two &amp; <strong>three</strong> &lt;script&gt;</p>',
    '<svg><script>bad()</script><text>svg</text></svg><p>End</p>',
  ].join('');
  const segments = parseHtmlTranscript(html, value => value);
  assert.deepEqual(segments, [
    { text: 'Hello link text' },
    { text: 'Two & three <script>' },
    { text: 'End' },
  ]);
  for (const { text } of segments) assert.doesNotMatch(text, /alert|steal|evil|secret|href|onerror|bad\(/);
});

test('HTML speakers and times come from cite and time', () => {
  const html = `
    <cite>Kevin:</cite> <time>0:00</time> <p>Welcome to the show.</p>
    <cite>Alice:</cite> <time datetime="PT1M2.5S">1:02</time> <p>Thanks, <em>Kevin</em>.</p>
    <p>Still Alice.</p>
    <time datetime="00:02:00">2:00</time><p>Two minutes in.</p>
    Line one<br>line two<br><br>Next paragraph`;
  assert.deepEqual(parseHtmlTranscript(html, value => value), [
    { start: 0, end: 62.5, speaker: 'Kevin', text: 'Welcome to the show.' },
    { start: 62.5, end: 120, speaker: 'Alice', text: 'Thanks, Kevin.' },
    { speaker: 'Alice', text: 'Still Alice.' },
    { start: 120, speaker: 'Alice', text: 'Two minutes in.' },
    { speaker: 'Alice', text: 'Line one line two' },
    { speaker: 'Alice', text: 'Next paragraph' },
  ]);
});

test('plain text splits into untimed paragraphs', () => {
  assert.deepEqual(parseTranscript('First para\r\nwraps here.\r\n\r\n  \r\nSecond para.\n', 'text/plain'), [
    { text: 'First para wraps here.' },
    { text: 'Second para.' },
  ]);
  assert.deepEqual(parseTranscript('One line\nAnother line\n', 'text/plain'), [{ text: 'One line' }, { text: 'Another line' }]);
  assert.deepEqual(parseTranscript('anything', 'application/pdf'), []);
});

test('cues are grouped by speaker, pauses under 2 s and about 30 s per paragraph', () => {
  const cues = [
    { start: 0, end: 2, speaker: 'A', text: 'one' },
    { start: 3.9, end: 5, speaker: 'A', text: 'two' },
    { start: 5, end: 6, speaker: 'B', text: 'speaker change' },
    { start: 8, end: 9, speaker: 'B', text: 'after 2 s gap' },
    { start: 9, end: 20, speaker: 'B', text: 'long' },
    { start: 20, end: 38, speaker: 'B', text: 'still within 30 s' },
    { start: 38, end: 40, speaker: 'B', text: 'over 30 s' },
    { text: 'untimed' },
    { start: 40, end: 41, speaker: 'B', text: 'after untimed' },
  ];
  const copy = structuredClone(cues);
  assert.deepEqual(groupSegments(cues), [
    { start: 0, end: 5, speaker: 'A', text: 'one two' },
    { start: 5, end: 6, speaker: 'B', text: 'speaker change' },
    { start: 8, end: 38, speaker: 'B', text: 'after 2 s gap long still within 30 s' },
    { start: 38, end: 40, speaker: 'B', text: 'over 30 s' },
    { text: 'untimed' },
    { start: 40, end: 41, speaker: 'B', text: 'after untimed' },
  ]);
  assert.deepEqual(cues, copy, 'the input is not modified');
  assert.deepEqual(groupSegments([{ text: 'a' }, { text: 'b' }]), [{ text: 'a' }, { text: 'b' }]);
});

/** Runs `parse` and checks it finished within `ms` (generous for slow machines; the old regexes took seconds). */
function assertFast(parse, ms = 500) {
  const started = performance.now();
  const result = parse();
  const elapsed = performance.now() - started;
  assert.ok(elapsed < ms, `took ${Math.round(elapsed)} ms`);
  return result;
}

test('a 1 MB cue line with unclosed tags and overrides parses in linear time', () => {
  const line = `<v Bob>Hello <b>world</b> {\\an8}${'<v '.repeat(150_000)}${'<'.repeat(300_000)}${'{\\'.repeat(150_000)}`;
  assert.ok(line.length >= 1_000_000);
  const cue = body => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${body}\n`;
  for (const type of ['text/vtt', 'application/srt']) {
    const [segment, ...rest] = assertFast(() => parseTranscript(cue(line), type));
    assert.equal(rest.length, 0);
    assert.equal(segment.text.length <= MAX_CUE_LINE_LENGTH, true, 'long lines are cut off');
    assert.ok(segment.text.startsWith('Hello world <v <v'));
    assert.equal(segment.speaker, type === 'text/vtt' ? 'Bob' : undefined);
  }
  assertFast(() => parseTranscript(cue(`<v${' '.repeat(1_000_000)}`), 'text/vtt'));
  assertFast(() => parseTranscript(cue(`{\\${'x'.repeat(1_000_000)}`), 'application/srt'));
});

test('cue tags and overrides are only removed when closed', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<b<v Ann>Hi</v> {\\an8}{\\i1 and 1 < 2';
  assert.deepEqual(parseTranscript(vtt, 'text/vtt'), [{ start: 1, end: 2, speaker: 'Ann', text: 'Hi {\\i1 and 1 < 2' }]);
  assert.deepEqual(parseTranscript(vtt.replace('WEBVTT\n\n', ''), 'application/srt'), [{ start: 1, end: 2, text: 'Hi {\\i1 and 1 < 2' }]);
});

test('HTML with many unclosed tags and comments parses in linear time', () => {
  const html = `<p>Start</p>${'<a'.repeat(250_000)}${'<!--'.repeat(125_000)}`;
  const segments = assertFast(() => parseHtmlTranscript(html, value => value));
  assert.equal(segments[0].text, 'Start');
  assert.ok(segments[1].text.startsWith('<a<a'));
  assert.deepEqual(parseHtmlTranscript('<p>One<!-- hidden --></p><p>a < b <!-- open', value => value), [{ text: 'One' }, { text: 'a < b <!-- open' }]);
});

test('caption formats are grouped, HTML and plain text are not', () => {
  const vtt = 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n\n00:01.000 --> 00:02.000\nthere';
  assert.deepEqual(transcriptParagraphs(vtt, 'text/vtt'), [{ start: 0, end: 2, text: 'Hello there' }]);
  const html = '<time>0:00</time><p>One</p><time>0:01</time><p>Two</p>';
  assert.equal(transcriptParagraphs(html, 'text/html', value => value).length, 2);
});

test('the active paragraph is the last one started', () => {
  const paragraphs = [{ start: 0, text: 'a' }, { start: 10, text: 'b' }, { start: 20, text: 'c' }];
  assert.equal(activeParagraph(paragraphs, -1), -1);
  assert.equal(activeParagraph(paragraphs, 0), 0);
  assert.equal(activeParagraph(paragraphs, 15), 1);
  assert.equal(activeParagraph(paragraphs, 20), 2);
  assert.equal(activeParagraph(paragraphs, 1e6), 2);
  assert.equal(activeParagraph([], 5), -1);
  assert.equal(activeParagraph([{ start: 5, text: 'x' }], 1), -1);
});

test('search finds case-insensitive matches in reading order', () => {
  const paragraphs = [{ text: 'The cat sat. THE end.' }, { text: 'No match' }, { text: 'a.b (the)' }];
  assert.deepEqual(findMatches(paragraphs, ' the '), [
    { paragraph: 0, start: 0, end: 3 },
    { paragraph: 0, start: 13, end: 16 },
    { paragraph: 2, start: 5, end: 8 },
  ]);
  assert.deepEqual(findMatches(paragraphs, '.b ('), [{ paragraph: 2, start: 1, end: 5 }]);
  assert.deepEqual(findMatches(paragraphs, '  '), []);
});
