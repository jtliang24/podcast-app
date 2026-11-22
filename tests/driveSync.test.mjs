import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { newProfile, recordEdit, applyBatch, seedProfile } from '../src/services/profileChanges.ts';
import { DriveSync, resumePoint } from '../src/services/driveSync.ts';
import { searchStateFile } from '../src/services/driveService.ts';
import { getPreferences } from '../src/services/preferences.ts';

const ep = { id: 'episode', audioUrl: 'audio', podcastId: 'feed', title: 'An episode' };
const show = { feedUrl: 'feed', title: 'A podcast' };
const position = time => state => ({
  ...state, lastPlayingEpisode: ep,
  playbackProgress: { ...state.playbackProgress, audio: { episodeUrl: 'audio', currentTime: time, duration: 100, lastUpdated: time } },
});

test('concurrent devices converge after rewinds, retries, removals and same-time edits', () => {
  const baseline = { subscriptions: [show], hidePlayedEpisodes: { old: true } };
  const phone = newProfile(baseline);
  const desktop = newProfile(baseline);
  recordEdit(phone, position(90), 'phone', false, 10);
  recordEdit(phone, position(12), 'phone', true, 20);
  recordEdit(desktop, s => ({ ...s, subscriptions: [{ feedUrl: 'other' }], hidePlayedEpisodes: { desktop: true } }), 'desktop', false, 10);
  recordEdit(phone, s => ({ ...s, hidePlayedEpisodes: { ...s.hidePlayedEpisodes, phone: true } }), 'phone', false, 30);
  recordEdit(desktop, s => ({ ...s, podcastSortOrders: { feed: 'newest' } }), 'desktop', false, 45);
  recordEdit(phone, s => ({ ...s, podcastSortOrders: { feed: 'oldest' } }), 'phone', false, 45);
  const batches = [...phone.pending, ...desktop.pending].map(p => JSON.parse(JSON.stringify(p.batch)));
  for (const batch of batches.toReversed()) applyBatch(phone, batch);
  for (const batch of [...batches, ...batches]) applyBatch(desktop, batch);
  assert.deepEqual(phone.state, desktop.state);
  assert.equal(resumePoint(phone.state).time, 12);
  assert.deepEqual(phone.state.subscriptions, [{ feedUrl: 'other' }]);
  assert.deepEqual(phone.state.hidePlayedEpisodes, { desktop: true, phone: true });
  assert.equal(phone.state.podcastSortOrders.feed, 'oldest');
});

test('an initial offline edit overlays the legacy snapshot once', () => {
  const offline = newProfile();
  recordEdit(offline, position(30), 'phone');
  const seeded = seedProfile(offline, { ...position(2)(newProfile().state), subscriptions: [show] });
  assert.equal(resumePoint(seeded.state).time, 30);
  assert.deepEqual(seeded.state.subscriptions, [show]);
  assert.equal(seedProfile(seeded, {}).pending.length, 1);
});

test('legacy and unsupported library preferences use the same defaults', () => {
  const defaults = { cellularDownload: 'ask', autoDownloadQueued: true, skipBackwardSeconds: 15, skipForwardSeconds: 30 };
  assert.deepEqual(getPreferences(newProfile().state), defaults);
  const imported = newProfile(JSON.parse('{"cellularDownload":"wifi","autoDownloadQueued":"off","skipBackwardSeconds":20,"skipForwardSeconds":"60"}'));
  assert.deepEqual(getPreferences(imported.state), defaults);
});

test('different preferences merge independently and survive a JSON round trip', () => {
  const phone = newProfile();
  const desktop = newProfile();
  recordEdit(phone, state => ({ ...state, cellularDownload: 'no', skipForwardSeconds: 60 }), 'phone', false, 30);
  recordEdit(desktop, state => ({ ...state, autoDownloadQueued: false, skipBackwardSeconds: 10 }), 'desktop', false, 10);
  const exchange = (from, to) => applyBatch(to, JSON.parse(JSON.stringify(from.pending[0].batch)));
  exchange(phone, desktop);
  exchange(desktop, phone);
  const expected = { cellularDownload: 'no', autoDownloadQueued: false, skipBackwardSeconds: 10, skipForwardSeconds: 60 };
  assert.deepEqual(getPreferences(phone.state), expected);
  assert.deepEqual(getPreferences(desktop.state), expected);
  const reopened = newProfile(JSON.parse(JSON.stringify(phone.state)));
  assert.deepEqual(getPreferences(reopened.state), expected);
});

// A transaction commits a structured clone, like IndexedDB. Each device has its own store.
function deviceStore() {
  const profiles = new Map();
  return async (id, edit) => {
    const p = structuredClone(profiles.get(id) ?? newProfile());
    const next = edit?.(p) ?? p;
    if (edit) profiles.set(id, structuredClone(next));
    return next;
  };
}

function syncSession(t, store, token, device) {
  const events = {};
  const listeners = Object.fromEntries(['status', 'state', 'expired', 'remote'].map(k => [k, v => { events[k] = v; }]));
  const engine = new DriveSync('library', token, device, listeners, store);
  t.after(() => engine.stop());
  return { engine, events };
}

async function until(check) {
  for (let i = 0; i < 100 && !check(); i++) await delay(5);
  assert.ok(check());
}

test('offline restart, expired access, lost upload acknowledgement and foreground handoff', async t => {
  let online = false;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  t.after(() => delete navigator.onLine);
  const uploads = new Map();
  let writes = 0;
  let lostAck = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const u = new URL(url);
    assert.ok(online);
    if (options.headers.Authorization === 'Bearer expired') return new Response(null, { status: 401 });
    if (u.pathname.endsWith('/generateIds')) return Response.json({ ids: [crypto.randomUUID()] });
    if (options.method === 'POST') {
      const parts = options.body.split('\r\n');
      const meta = JSON.parse(parts[3]);
      const batch = JSON.parse(parts[7]);
      assert.equal(meta.appProperties.profile, 'library');
      writes++;
      if (uploads.has(meta.id)) return new Response(null, { status: 409 });
      uploads.set(meta.id, { meta, batch });
      if (lostAck) { lostAck = false; throw new Error('response lost'); }
      return Response.json({ id: meta.id });
    }
    if (u.searchParams.get('alt') === 'media') {
      const id = u.pathname.split('/').at(-1);
      return Response.json(id === 'library' ? { subscriptions: [show] } : uploads.get(id).batch);
    }
    if (u.searchParams.get('q').includes("name = 'podcast_state.json'")) {
      if (!u.searchParams.has('pageToken')) return Response.json({ files: [{ id: 'other' }], nextPageToken: 'next' });
      return Response.json({ files: [{ id: 'library' }] });
    }
    return Response.json({ files: [...uploads.values()].map(({ meta }) => meta) });
  });
  const phone = deviceStore();
  const desktop = syncSession(t, deviceStore(), 'valid', 'desktop');
  online = true;
  await desktop.engine.restore();
  await until(() => desktop.events.status === 'Synced');
  assert.equal(await searchStateFile('valid', 'missing-profile'), null);
  assert.equal(await searchStateFile('valid', 'library'), 'library');
  const first = syncSession(t, phone, 'expired', 'phone');
  online = false;
  await first.engine.restore();
  await first.engine.edit(position(60));
  await first.engine.edit(position(42.75), true);
  assert.equal(first.events.status, 'Saved on this device');
  first.engine.stop();
  const reopened = syncSession(t, phone, 'expired', 'phone');
  await reopened.engine.restore();
  assert.equal(resumePoint(reopened.events.state).time, 42.75);
  online = true;
  reopened.engine.refresh();
  await until(() => reopened.events.status === 'Reconnect Google Drive');
  assert.equal((await phone('library')).pending.length, 1);
  reopened.engine.stop();
  const signedIn = syncSession(t, phone, 'valid', 'phone');
  await signedIn.engine.restore();
  await until(() => writes === 1 && signedIn.events.status === 'Saved on this device');
  signedIn.engine.refresh();
  await until(() => signedIn.events.status === 'Synced');
  assert.equal(writes, 2);
  assert.equal(uploads.size, 1);
  assert.equal((await phone('library')).pending.length, 0);
  desktop.engine.refresh();
  await until(() => desktop.events.remote?.time === 42.75);
  assert.deepEqual(desktop.events.state.subscriptions, [show]);
});

test('an existing playback backlog uploads its latest checkpoint and preserves queue edits', async t => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  t.after(() => delete navigator.onLine);
  const phone = deviceStore();
  await phone('library', p => {
    const profile = seedProfile(p, { subscriptions: [show] });
    recordEdit(profile, position(60), 'phone', true, 60);
    profile.pending[0].fileId = 'reserved-old-checkpoint';
    recordEdit(profile, state => ({ ...state, queue: [ep] }), 'phone', false, 70);
    recordEdit(profile, position(42.75), 'phone', false, 80);
    return profile;
  });

  const uploads = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('/generateIds')) return Response.json({ ids: [crypto.randomUUID()] });
    if (options.method === 'POST') {
      const parts = options.body.split('\r\n');
      const meta = JSON.parse(parts[3]);
      assert.notEqual(meta.id, 'reserved-old-checkpoint');
      uploads.push(JSON.parse(parts[7]));
      return Response.json({ id: meta.id });
    }
    return Response.json({ files: [] });
  });

  const { engine, events } = syncSession(t, phone, 'valid', 'phone');
  await engine.restore();
  await until(() => events.status === 'Synced');
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].changes.find(change => change.field === 'playbackProgress').value.currentTime, 42.75);
  assert.deepEqual(uploads[1].changes, [{ field: 'queue', value: [ep] }]);
  assert.equal((await phone('library')).pending.length, 0);
});

test('a stalled upload leaves progress pending and retries the same Drive file', { timeout: 2000 }, async t => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  t.after(() => delete navigator.onLine);
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const phone = deviceStore();
  await phone('library', p => {
    const profile = seedProfile(p, {});
    recordEdit(profile, position(30), 'phone');
    return profile;
  });

  const started = Promise.withResolvers();
  const saved = Promise.withResolvers();
  const synced = Promise.withResolvers();
  const uploads = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('/generateIds')) return Response.json({ ids: [crypto.randomUUID()] });
    if (options.method === 'POST') {
      const meta = JSON.parse(options.body.split('\r\n')[3]);
      uploads.push(meta.id);
      if (uploads.length === 1) {
        started.resolve();
        return new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        });
      }
      return new Response(null, { status: 409 });
    }
    return Response.json({ files: [] });
  });

  let status;
  const engine = new DriveSync('library', 'valid', 'phone', {
    state: () => {}, remote: () => {}, expired: () => assert.fail('Access expired'),
    status: value => {
      if (status === 'Syncing' && value === 'Saved on this device') saved.resolve();
      if (value === 'Synced') synced.resolve();
      status = value;
    },
  }, phone);
  t.after(() => engine.stop());

  await engine.restore();
  t.mock.timers.tick(0);
  await started.promise;
  t.mock.timers.tick(15_000);
  await saved.promise;
  assert.equal((await phone('library')).pending[0].fileId, uploads[0]);

  t.mock.timers.tick(2_001);
  await synced.promise;
  assert.deepEqual(uploads, [uploads[0], uploads[0]]);
  assert.equal((await phone('library')).pending.length, 0);
});
