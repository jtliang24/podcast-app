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

async function until(check, attempts = 100) {
  for (let i = 0; i < attempts && !check(); i++) await delay(5);
  assert.ok(check());
}

function driveFeed(url, uploads = []) {
  if (url.pathname.endsWith('/startPageToken')) return Response.json({ startPageToken: String(uploads.length) });
  if (!url.pathname.endsWith('/changes')) return;
  const start = Number(url.searchParams.get('pageToken'));
  const changes = uploads.slice(start).map(file => ({ file }));
  return Response.json({ changes, newStartPageToken: String(uploads.length) });
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
    const feed = driveFeed(u, [...uploads.values()].map(({ meta }) => meta));
    if (feed) return feed;
    if (u.searchParams.get('q').includes("name = 'podcast_state.json'")) {
      if (!u.searchParams.has('pageToken')) return Response.json({ files: [{ id: 'other' }], nextPageToken: 'next' });
      return Response.json({ files: [{ id: 'library' }] });
    }
    return Response.json({ files: [...uploads.values()].map(({ meta }) => meta) });
  });
  const phone = deviceStore();
  online = true;
  const desktop = syncSession(t, deviceStore(), 'valid', 'desktop');
  await desktop.engine.restore();
  await until(() => desktop.events.status === 'Synced');
  assert.equal(await searchStateFile('valid', 'missing-profile'), null);
  assert.equal(await searchStateFile('valid', 'library'), 'library');
  online = false;
  const first = syncSession(t, phone, 'expired', 'phone');
  await first.engine.restore();
  await first.engine.edit(position(60), false, true);
  await first.engine.edit(position(42.75), true);
  assert.equal(first.events.status, 'Saved on this device');
  first.engine.stop();
  const reopened = syncSession(t, phone, 'expired', 'phone');
  await reopened.engine.restore();
  assert.equal(resumePoint(reopened.events.state).time, 42.75);
  online = true;
  reopened.engine.setEnvironment('limited', true, false);
  await until(() => reopened.events.status === 'Reconnect Google Drive');
  assert.equal((await phone('library')).pending.length, 1);
  reopened.engine.stop();
  const signedIn = syncSession(t, phone, 'valid', 'phone');
  await signedIn.engine.restore();
  await until(() => writes === 1 && signedIn.events.status === 'Saved on this device');
  signedIn.engine.refresh();
  await until(() => signedIn.events.status === 'Synced', 600);
  assert.equal(writes, 2);
  assert.equal(uploads.size, 1);
  assert.equal((await phone('library')).pending.length, 0);
  desktop.engine.refresh();
  await until(() => desktop.events.remote?.time === 42.75);
  assert.deepEqual(desktop.events.state.subscriptions, [show]);
});

test('an existing playback backlog preserves reserved checkpoints and queue edits', async t => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  t.after(() => delete navigator.onLine);
  const phone = deviceStore();
  await phone('library', p => {
    const profile = seedProfile(p, { subscriptions: [show] });
    const legacyCheckpoint = (time, urgent) => {
      const state = position(time)(profile.state);
      const batch = {
        id: 'legacy-' + time, time, device: 'phone', changes: [
          { field: 'playbackProgress', key: 'audio', value: state.playbackProgress.audio },
          { field: 'lastPlayingEpisode', value: ep },
        ],
      };
      applyBatch(profile, batch);
      const entry = { batch, urgent };
      profile.pending.push(entry);
      return entry;
    };
    legacyCheckpoint(60, true).fileId = 'reserved-old-checkpoint';
    legacyCheckpoint(65, false);
    recordEdit(profile, state => ({ ...state, queue: [ep] }), 'phone', false, 70);
    legacyCheckpoint(80, false);
    return profile;
  });

  const uploads = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('/generateIds')) return Response.json({ ids: [crypto.randomUUID()] });
    if (options.method === 'POST') {
      const parts = options.body.split('\r\n');
      const meta = JSON.parse(parts[3]);
      uploads.push({ id: meta.id, batch: JSON.parse(parts[7]) });
      return Response.json({ id: meta.id });
    }
    return driveFeed(new URL(url)) ?? Response.json({ files: [] });
  });

  const { engine, events } = syncSession(t, phone, 'valid', 'phone');
  await engine.restore();
  await until(() => events.status === 'Synced');
  assert.equal(uploads.length, 3);
  assert.equal(uploads[0].id, 'reserved-old-checkpoint');
  assert.equal(uploads[0].batch.changes.find(change => change.field === 'playbackProgress').value.currentTime, 60);
  assert.deepEqual(uploads[1].batch.changes, [{ field: 'queue', value: [ep] }]);
  assert.equal(uploads[2].batch.changes.find(change => change.field === 'playbackProgress').value.currentTime, 80);
  assert.equal((await phone('library')).pending.length, 0);
});

test('a stalled upload leaves progress pending and retries the same Drive file', { timeout: 2000 }, async t => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  t.after(() => delete navigator.onLine);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });

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
    return driveFeed(new URL(url)) ?? Response.json({ files: [] });
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

function useClock(t) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  t.after(() => delete navigator.onLine);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
  return async (ms = 0) => {
    t.mock.timers.tick(ms);
    await new Promise(resolve => setImmediate(resolve));
  };
}

test('only visible paused Wi-Fi tabs poll, with one shared check per interval', async t => {
  const tick = useClock(t);
  const shared = deviceStore();
  await shared('library', p => {
    const seeded = seedProfile(p, {});
    seeded.feed = { token: '10000' };
    seeded.applied = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => ['historical-' + i, true]));
    return seeded;
  });
  const requests = [];
  let inFlight;
  let holdNextPull = false;
  t.mock.method(globalThis, 'fetch', async url => {
    const u = new URL(url);
    assert.ok(u.pathname.endsWith('/changes'));
    assert.equal(u.searchParams.get('pageToken'), '10000');
    requests.push(Date.now());
    if (holdNextPull) {
      holdNextPull = false;
      inFlight = Promise.withResolvers();
      await inFlight.promise;
    }
    return Response.json({ changes: [], newStartPageToken: '10000' });
  });
  const a = syncSession(t, shared, 'valid', 'desktop').engine;
  const b = syncSession(t, shared, 'valid', 'desktop').engine;
  await Promise.all([a.restore(), b.restore()]);
  await tick();
  assert.equal(requests.length, 1);
  await tick(45_000);
  assert.equal(requests.length, 1);

  a.setEnvironment('unmetered', true, false);
  b.setEnvironment('unmetered', true, false);
  a.refresh();
  await tick();
  assert.equal(requests.length, 2);
  await tick(14_999);
  assert.equal(requests.length, 2);
  await tick(1);
  await tick();
  assert.equal(requests.length, 3);
  holdNextPull = true;
  await tick(15_000);
  await tick();
  assert.equal(requests.length, 4);
  a.setEnvironment('limited', true, false);
  b.setEnvironment('limited', true, false);
  inFlight.resolve();
  await tick();
  await tick(60_000);
  assert.equal(requests.length, 4);

  a.setEnvironment('offline', true, false);
  b.setEnvironment('offline', true, false);
  a.refresh();
  await tick();
  assert.equal(requests.length, 4);
  a.setEnvironment('limited', true, false);
  b.setEnvironment('limited', true, false);
  await tick();
  assert.equal(requests.length, 5);
  await tick(15_000);
  a.refresh();
  b.refresh();
  await tick();
  assert.equal(requests.length, 6);

  await tick(1000);
  a.setEnvironment('unmetered', true, true);
  b.setEnvironment('unmetered', false, false);
  await tick();
  await tick(45_000);
  assert.equal(requests.length, 7);
  a.setEnvironment('unmetered', true, false);
  await tick(15_000);
  await tick();
  assert.equal(requests.length, 8);
});

test('an hour of foreground playback sends 120 compact checkpoints using six ID reservations', async t => {
  const tick = useClock(t);
  const store = deviceStore();
  let reservations = 0;
  const uploads = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/generateIds')) {
      reservations++;
      assert.equal(u.searchParams.get('count'), '20');
      return Response.json({ ids: Array.from({ length: 20 }, () => crypto.randomUUID()) });
    }
    if (options.method === 'POST') {
      const [, , , metadata, , , , content] = options.body.split('\r\n');
      uploads.push(JSON.parse(content));
      return Response.json({ id: JSON.parse(metadata).id });
    }
    return driveFeed(u) ?? Response.json({ files: [] });
  });
  await store('library', () => seedProfile(newProfile(), {}));
  const episode = { ...ep, description: 'Episode description' };
  const save = time => state => ({ ...position(time)(state), lastPlayingEpisode: { ...episode } });
  let { engine } = syncSession(t, store, 'valid', 'desktop');
  engine.setEnvironment('limited', true, true);
  await engine.restore();
  await tick();
  for (let seconds = 0; seconds < 3600; seconds += 10) {
    await engine.edit(save(seconds), false, true);
    if (seconds === 20) {
      const due = (await store('library')).pending[0].due;
      engine.stop();
      ({ engine } = syncSession(t, store, 'valid', 'desktop'));
      engine.setEnvironment('limited', true, true);
      await engine.restore();
      assert.equal((await store('library')).pending[0].due, due);
    }
    await tick(10_000);
    await tick();
  }
  assert.equal(uploads.length, 120);
  assert.equal(reservations, 6);
  assert.ok(JSON.stringify(uploads[0]).includes(episode.description));
  assert.ok(!JSON.stringify(uploads.slice(1)).includes(episode.description));
  assert.equal((await store('library')).pending.length, 0);
});

test('a delayed metadata batch resolves the latest session through an intentional rewind', () => {
  const source = newProfile({});
  const receiver = newProfile({});
  recordEdit(source, position(90), 'phone', false, 100, true);
  const first = structuredClone(source.pending[0].batch);
  source.pending[0].fileId = 'immutable';
  recordEdit(source, position(12), 'phone', true, 110);
  const rewind = source.pending.at(-1).batch;
  assert.deepEqual(source.pending[0].batch, first);
  assert.equal(rewind.changes.some(change => change.field === 'episodeMetadata'), false);
  applyBatch(receiver, rewind);
  assert.equal(resumePoint(receiver.state), null);
  applyBatch(receiver, first);
  assert.equal(resumePoint(receiver.state).time, 12);
});

test('change pages resume atomically after a failure and respect Retry-After', async t => {
  const tick = useClock(t);
  const store = deviceStore();
  const remote = newProfile({});
  recordEdit(remote, position(55), 'phone', true, 51);
  recordEdit(remote, position(13), 'phone', true, 52);
  recordEdit(remote, state => ({ ...state, skipForwardSeconds: 60 }), 'phone', true, 53);
  const batches = remote.pending.map(entry => entry.batch);
  const files = batches.map(batch => ({ id: batch.id, name: batch.id, appProperties: { profile: 'library' } }));
  const requests = [];
  let fail = true;
  t.mock.method(globalThis, 'fetch', async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/startPageToken')) {
      requests.push('start');
      return Response.json({ startPageToken: 'first' });
    }
    if (u.pathname.endsWith('/changes')) {
      const cursor = u.searchParams.get('pageToken');
      requests.push(cursor);
      return cursor === 'first'
        ? Response.json({ changes: [{ file: files[0] }], nextPageToken: 'second' })
        : Response.json({ changes: files.slice(1).map(file => ({ file })), newStartPageToken: 'caught-up' });
    }
    if (u.searchParams.get('alt') === 'media') {
      const id = u.pathname.split('/').at(-1);
      if (id === 'library') {
        requests.push('snapshot');
        return Response.json({ subscriptions: [show] });
      }
      if (id === files[2].id && fail) {
        fail = false;
        return new Response(null, { status: 429, headers: { 'Retry-After': '7' } });
      }
      return Response.json(batches.find(batch => batch.id === id));
    }
    requests.push('scan');
    return Response.json({ files: [] });
  });
  const first = syncSession(t, store, 'valid', 'desktop');
  await first.engine.restore();
  await tick();
  assert.deepEqual(requests, ['start', 'snapshot', 'scan', 'first', 'second']);
  let profile = await store('library');
  assert.equal(profile.feed.token, 'second');
  assert.equal(resumePoint(profile.state).time, 55);
  assert.equal(profile.state.skipForwardSeconds, undefined);
  assert.equal(profile.applied[batches[1].id], undefined);
  first.engine.stop();

  const second = syncSession(t, store, 'valid', 'desktop');
  await second.engine.restore();
  await tick();
  await tick(6999);
  assert.equal(requests.length, 5);
  second.engine.refresh();
  await tick();
  assert.equal(requests.length, 5);
  await tick(1);
  profile = await store('library');
  assert.equal(requests.at(-1), 'second');
  assert.equal(profile.feed.token, 'caught-up');
  assert.equal(second.events.remote.time, 13);
  assert.equal(profile.state.skipForwardSeconds, 60);
});

test('Wi-Fi receives a cellular pause on its next poll and cellular receives a rewind on foreground', async t => {
  const tick = useClock(t);
  const uploads = new Map();
  const desktopRequests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/generateIds')) {
      return Response.json({ ids: Array.from({ length: 20 }, () => crypto.randomUUID()) });
    }
    if (options.method === 'POST') {
      const parts = options.body.split('\r\n');
      const file = JSON.parse(parts[3]);
      uploads.set(file, JSON.parse(parts[7]));
      if (options.headers.Authorization === 'Bearer desktop') desktopRequests.push('upload');
      return Response.json({ id: file.id });
    }
    if (u.searchParams.get('alt') === 'media') {
      const id = u.pathname.split('/').at(-1);
      return Response.json([...uploads].find(([file]) => file.id === id)?.[1] ?? {});
    }
    if (u.pathname.endsWith('/changes') && options.headers.Authorization === 'Bearer desktop') {
      desktopRequests.push('pull');
    }
    return driveFeed(u, [...uploads.keys()]) ?? Response.json({ files: [...uploads.keys()] });
  });

  const phone = syncSession(t, deviceStore(), 'phone', 'phone');
  const laptopStore = deviceStore();
  const laptop = syncSession(t, laptopStore, 'desktop', 'desktop');
  laptop.engine.setEnvironment('unmetered', true, false);
  await Promise.all([phone.engine.restore(), laptop.engine.restore()]);
  await tick();
  await tick(1000);
  await phone.engine.edit(position(77), true);
  await tick();
  assert.equal(laptop.events.remote, undefined);
  await laptopStore('library', p => {
    for (let i = 0; i < 12; i++) recordEdit(p, s => ({ ...s, hidePlayedEpisodes: { ['feed' + i]: true } }), 'desktop');
  });
  desktopRequests.length = 0;
  await tick(14_000);
  assert.equal(laptop.events.remote.time, 77);
  assert.deepEqual(desktopRequests, ['pull', ...Array(12).fill('upload')]);

  await laptop.engine.edit(position(18), true);
  await tick();
  await tick(15_000);
  assert.equal(phone.events.remote, undefined);
  phone.engine.setEnvironment('limited', false, false);
  phone.engine.setEnvironment('limited', true, false);
  await tick();
  assert.equal(phone.events.remote.time, 18);
});
