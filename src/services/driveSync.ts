import type { AppState, Episode } from '../types.ts';
import { accessProfile } from './profileStore.ts';
import { applyBatch, coalescePlaybackCheckpoints, recordEdit, seedProfile } from './profileChanges.ts';
import type { Batch, Profile, StateUpdate } from './profileChanges.ts';
import { downloadStateFile, DriveError, getStartPageToken, listBatchPage, listChangePage, reserveFileIds, uploadBatch } from './driveService.ts';

const pollInterval = 15_000;
const pullLeaseDuration = 120_000;
const eventOverlap = 500;

export type SyncNetwork = 'offline' | 'unmetered' | 'limited';
export type SyncStatus = 'Saved on this device' | 'Syncing' | 'Synced' | 'Reconnect Google Drive';
export interface ResumePoint { episode: Episode; time: number }

export function resumePoint(state: AppState): ResumePoint | null {
  const episode = state.lastPlayingEpisode;
  return episode ? { episode, time: state.playbackProgress[episode.audioUrl]?.currentTime ?? 0 } : null;
}

interface Events {
  state: (state: AppState) => void;
  status: (status: SyncStatus) => void;
  remote: (point: ResumePoint | null) => void;
  expired: () => void;
}

type Pull = 'event' | 'periodic';
type Pending = Profile['pending'][number];

export class DriveSync {
  private id: string;
  private token: string | null;
  private device: string;
  private events: Events;
  private store: typeof accessProfile;
  private stopped = false;
  private running = false;
  private workRequested = false;
  private pulling = false;
  private pull?: Pull;
  private network: SyncNetwork = navigator.onLine ? 'limited' : 'offline';
  private visible = true;
  private playing = false;
  private catchUp = true;
  private timer?: ReturnType<typeof setTimeout>;
  private wakeAt = Infinity;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = 2000;
  private retryAt = 0;
  private owner = crypto.randomUUID();
  private point: ResumePoint | null = null;
  private channel?: BroadcastChannel;

  constructor(id: string, token: string | null, device: string, events: Events, store = accessProfile) {
    this.id = id;
    this.token = token;
    this.device = device;
    this.events = events;
    this.store = store;
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`podcast-drive:${id}`);
      this.channel.onmessage = () => {
        void this.store(this.id).then(profile => this.publish(profile, true)).catch(console.error);
      };
    }
  }

  async restore() {
    const profile = await this.store(this.id);
    if (this.stopped) return;
    this.publish(profile);
    this.refresh();
  }

  async edit(update: StateUpdate, urgent = false, routine = false) {
    const profile = await this.store(this.id, p => recordEdit(p, update, this.device, urgent, Date.now(), routine));
    if (this.stopped) return;
    this.publish(profile);
    if (profile.pending.length) this.schedule();
  }

  setEnvironment(network: SyncNetwork, visible: boolean, playing: boolean) {
    const wasPolling = this.canPoll;
    const reconnect = this.network === 'offline' && network !== 'offline';
    const foreground = visible && !this.visible;
    const unmetered = network === 'unmetered' && this.network !== network;
    const started = playing && !this.playing;
    this.network = network;
    this.visible = visible;
    this.playing = playing;
    if (!this.canPoll) {
      clearTimeout(this.pollTimer);
      if (this.pull === 'periodic') this.pull = undefined;
    } else if (!wasPolling) {
      this.armPoll();
    }
    if (!this.online) {
      clearTimeout(this.timer);
      this.wakeAt = Infinity;
      this.events.status(this.token ? 'Saved on this device' : 'Reconnect Google Drive');
      return;
    }
    if (reconnect || (visible && (foreground || unmetered))) {
      this.catchUp = true;
      this.refresh();
    } else if (started) {
      this.schedule();
    }
  }

  refresh() {
    if (this.pulling || this.stopped) return;
    this.pull = 'event';
    this.armPoll();
    this.schedule();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.pollTimer);
    this.channel?.close();
  }

  private get online() {
    return !this.stopped && this.network !== 'offline';
  }

  private get canPoll() {
    return this.online && !!this.token && this.visible && !this.playing && this.network === 'unmetered';
  }

  private armPoll(at = Date.now() + pollInterval) {
    clearTimeout(this.pollTimer);
    if (!this.canPoll) return;
    this.pollTimer = setTimeout(() => {
      if (!this.canPoll) return;
      if (!this.pulling) {
        this.pull ??= 'periodic';
        this.schedule();
      }
      this.armPoll();
    }, Math.max(0, at - Date.now()));
  }

  private schedule(at = Date.now()) {
    if (!this.online || !this.token) {
      if (!this.stopped) this.events.status(this.token ? 'Saved on this device' : 'Reconnect Google Drive');
      return;
    }
    if (this.running) {
      this.workRequested = true;
      return;
    }
    const wakeAt = Math.max(at, this.retryAt);
    if (wakeAt >= this.wakeAt) return;
    clearTimeout(this.timer);
    this.wakeAt = wakeAt;
    this.timer = setTimeout(() => {
      this.wakeAt = Infinity;
      void this.run();
    }, Math.max(0, wakeAt - Date.now()));
  }

  private publish(profile: Profile, remote = false) {
    if (this.stopped) return;
    const previous = this.point;
    this.point = resumePoint(profile.state);
    this.events.state(profile.state);
    if (remote && (previous?.episode.audioUrl !== this.point?.episode.audioUrl || previous?.time !== this.point?.time)) {
      this.events.remote(this.point);
    }
  }

  private nextUpload(profile: Profile, now: number) {
    return profile.pending.find(entry => entry.urgent) ?? profile.pending.find(entry =>
      entry.due === undefined || (this.visible && (this.playing || this.catchUp) && entry.due <= now));
  }

  private async run() {
    const token = this.token;
    if (!token || !this.online) return;
    this.running = true;
    this.workRequested = false;
    let nextWake = Infinity;
    try {
      let profile = await this.store(this.id);
      while (this.online) {
        const pull = this.pull;
        this.pull = undefined;
        if (pull || !profile.feed || profile.feed.scanPage !== undefined) {
          this.events.status('Syncing');
          this.pulling = true;
          try {
            const deferUntil = await this.pullChanges(token, pull ?? 'event');
            if (deferUntil) {
              if (pull === 'periodic') this.armPoll(deferUntil);
              else {
                this.pull ??= 'event';
                nextWake = deferUntil;
              }
            }
          } catch (error) {
            if (pull !== 'periodic' || this.canPoll) this.pull ??= pull ?? 'event';
            throw error;
          } finally {
            this.pulling = false;
          }
          profile = await this.store(this.id);
          if (!profile.feed || profile.feed.scanPage !== undefined || !this.online) break;
        }

        if (!this.nextUpload(profile, Date.now())) break;
        this.events.status('Syncing');
        // Give a foreground pull a turn even when playback keeps adding checkpoints.
        profile = await this.uploadNext(token);
        if (nextWake !== Infinity && this.pull) break;
      }
      if (this.visible && (this.playing || this.catchUp)) {
        for (const entry of profile.pending) {
          if (entry.due !== undefined) nextWake = Math.min(nextWake, entry.due);
        }
      }
      if (!profile.pending.some(entry => entry.due !== undefined)) this.catchUp = false;
      if (this.online) this.events.status(profile.pending.length ? 'Saved on this device' : 'Synced');
      this.retryAt = 0;
      this.retryDelay = 2000;
    } catch (error) {
      if (this.stopped) return;
      if (error instanceof DriveError && (error.status === 401 || error.status === 404)) {
        this.token = null;
        clearTimeout(this.pollTimer);
        this.events.expired();
        this.events.status('Reconnect Google Drive');
      } else {
        this.events.status('Saved on this device');
        this.retryAt = this.backoff(error);
        this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
        nextWake = this.retryAt;
      }
    } finally {
      this.running = false;
      if (this.workRequested || (nextWake === Infinity && this.pull)) nextWake = Date.now();
      if (nextWake !== Infinity && this.token && this.online) this.schedule(nextWake);
    }
  }

  private backoff(error: unknown) {
    return Math.max(Date.now() + this.retryDelay, error instanceof DriveError ? error.retryAt : 0);
  }

  private async uploadNext(token: string) {
    let entry: Pending | undefined;
    const assign = (p: Profile) => {
      const now = Date.now();
      const next = this.nextUpload(p, now);
      if (!next) return;
      if (!next.fileId) {
        next.fileId = p.fileIds?.shift();
        if (!next.fileId) return;
        if (next.checkpoint) (p.lastCheckpointUpload ??= {})[next.checkpoint] = now;
      }
      entry = next;
    };
    let profile = await this.store(this.id, assign);
    if (!entry && this.online && this.nextUpload(profile, Date.now())) {
      const ids = await reserveFileIds(token);
      profile = await this.store(this.id, p => {
        (p.fileIds ??= []).push(...ids);
        assign(p);
      });
    }
    if (!entry || !this.online) return profile;
    await uploadBatch(token, this.id, entry.fileId!, entry.batch);
    return this.store(this.id, p => {
      p.pending = p.pending.filter(item => item.batch.id !== entry?.batch.id);
    });
  }

  private async pullChanges(token: string, trigger: Pull) {
    const now = Date.now();
    let deferUntil = 0;
    let claimed = false;
    let profile = await this.store(this.id, p => {
      if (p.pullLease && p.pullLease.until > now) {
        // Give the other tab time to publish its completed pull.
        if (trigger === 'periodic') deferUntil = now + pollInterval;
        return;
      }
      if (p.pullRetryAt && p.pullRetryAt > now) {
        deferUntil = p.pullRetryAt;
        return;
      }
      if (p.lastPull !== undefined && now - p.lastPull < (trigger === 'periodic' ? pollInterval : eventOverlap)) {
        if (trigger === 'periodic') deferUntil = p.lastPull + pollInterval;
        return;
      }
      p.pullLease = { owner: this.owner, until: now + pullLeaseDuration };
      claimed = true;
    });
    if (!claimed) {
      // Another tab may have already applied the latest batches.
      this.publish(profile, true);
      // Bootstrap must finish before any newly queued changes are uploaded.
      return deferUntil || (!profile.feed || profile.feed.scanPage !== undefined ? now + eventOverlap : 0);
    }

    let retryAt: number | undefined;
    try {
      if (!profile.feed && this.online) {
        const start = await getStartPageToken(token);
        profile = await this.store(this.id, p => { p.feed = { token: start, scanPage: '' }; });
      }
      if (!profile.seeded && this.online) {
        const snapshot = JSON.parse(await downloadStateFile(token, this.id));
        profile = await this.store(this.id, p => seedProfile(p, snapshot));
        this.publish(profile);
      }
      while (profile.feed && this.online) {
        const { token: cursor, scanPage } = profile.feed;
        const scan = scanPage !== undefined;
        const page = scan
          ? await listBatchPage(token, this.id, scanPage).then(({ files, nextPageToken }) => ({
            files, nextToken: cursor, scanPage: nextPageToken, more: true,
          }))
          : { ...await listChangePage(token, this.id, cursor), scanPage: undefined };
        const missing = [...new Map(page.files.map(file => [file.name, file])).values()]
          .filter(file => !Object.hasOwn(profile.applied, file.name));
        const batches: Batch[] = [];
        // Bound network concurrency while catching up on a long offline session.
        for (let start = 0; start < missing.length; start += 10) {
          if (!this.online) return 0;
          batches.push(...await Promise.all(missing.slice(start, start + 10).map(async file => {
            try {
              const batch: Batch = JSON.parse(await downloadStateFile(token, file.id));
              if (batch.id !== file.name) throw new Error('Unexpected Drive batch ID');
              return batch;
            } catch (error) {
              // A file can disappear between listing the change and downloading it.
              if (!(error instanceof DriveError && error.status === 404)) throw error;
              return null;
            }
          })).then(items => items.filter(batch => batch !== null)));
          if ((profile.pullLease?.until ?? 0) - Date.now() < pullLeaseDuration / 2) {
            profile = await this.store(this.id, p => {
              if (p.pullLease?.owner === this.owner) p.pullLease.until = Date.now() + pullLeaseDuration;
            });
            if (profile.pullLease?.owner !== this.owner) return 0;
          }
        }
        profile = await this.store(this.id, p => {
          if (p.pullLease?.owner !== this.owner) return;
          for (const batch of batches) applyBatch(p, batch);
          p.feed = { token: page.nextToken, scanPage: page.scanPage };
          // Compact checkpoints already queued by older versions of the app.
          if (scan && page.scanPage === undefined) coalescePlaybackCheckpoints(p);
        });
        this.publish(profile, true);
        if (batches.length && !this.stopped) this.channel?.postMessage('pull');
        if (!page.more || profile.pullLease?.owner !== this.owner) break;
      }
    } catch (error) {
      if (!(error instanceof DriveError && (error.status === 401 || error.status === 404))) {
        retryAt = this.backoff(error);
      }
      throw error;
    } finally {
      await this.store(this.id, p => {
        if (p.pullLease?.owner !== this.owner) return;
        p.pullLease = undefined;
        p.pullRetryAt = retryAt;
        if (!retryAt && this.online) p.lastPull = now;
      });
    }
    return 0;
  }
}
