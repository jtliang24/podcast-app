import assert from 'node:assert/strict';
import test from 'node:test';
import { pickTranscript, transcriptFormat } from '../src/services/transcripts.ts';

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
