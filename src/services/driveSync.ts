import type { AppState, Episode } from '../types.ts';
import { accessProfile } from './profileStore.ts';
import { applyBatch, recordEdit, seedProfile } from './profileChanges.ts';
import type { Batch, Profile, StateUpdate } from './profileChanges.ts';
import { allocateFileId, downloadStateFile, DriveError, listBatches, uploadBatch } from './driveService.ts';

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

export class DriveSync {
  private id: string;
  private token: string | null;
  private device: string;
  private events: Events;
  private store: typeof accessProfile;
  private stopped = false;
  private running = false;
  private requested = false;
  private pull = false;
  private timer?: ReturnType<typeof setTimeout>;
  private retryDelay = 2000;

  constructor(id: string, token: string | null, device: string, events: Events, store = accessProfile) {
    this.id = id;
    this.token = token;
    this.device = device;
    this.events = events;
    this.store = store;
  }

  async restore() {
    const profile = await this.store(this.id);
    if (this.stopped) return;
    this.events.state(profile.state);
    this.refresh();
  }

  async edit(update: StateUpdate, urgent = false) {
    const profile = await this.store(this.id, p => recordEdit(p, update, this.device, urgent));
    if (this.stopped) return;
    this.events.state(profile.state);
    if (profile.pending.length) this.schedule(urgent ? 0 : 500);
  }

  refresh() {
    this.pull = true;
    this.schedule(0);
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    if (!this.token || !navigator.onLine) {
      this.events.status(this.token ? 'Saved on this device' : 'Reconnect Google Drive');
      return;
    }
    this.requested = true;
    if (this.running) return;
    this.events.status('Saved on this device');
    if (delay && this.timer) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.run(); }, delay);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private async run() {
    const token = this.token;
    if (!token || this.stopped) return;
    this.running = true;
    this.events.status('Syncing');
    try {
      while (this.requested && !this.stopped) {
        this.requested = false;
        const pull = this.pull;
        this.pull = false;
        let profile = await this.store(this.id);
        if (!profile.seeded) {
          const snapshot = JSON.parse(await downloadStateFile(token, this.id));
          profile = await this.store(this.id, p => seedProfile(p, snapshot));
          if (!this.stopped) this.events.state(profile.state);
        }
        await this.flush(token, profile);
        if (pull && !this.stopped) await this.pullChanges(token);
      }
      if (!this.stopped) this.events.status('Synced');
      this.retryDelay = 2000;
    } catch (error) {
      if (this.stopped) return;
      this.pull = true;
      if (error instanceof DriveError && (error.status === 401 || error.status === 404)) {
        this.token = null;
        this.events.expired();
        this.events.status('Reconnect Google Drive');
      } else {
        this.events.status('Saved on this device');
        if (navigator.onLine) {
          this.timer = setTimeout(() => this.refresh(), this.retryDelay);
          this.retryDelay = Math.min(this.retryDelay * 2, 60000);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async flush(token: string, profile: Profile) {
    while (profile.pending.length && !this.stopped) {
      const entry = profile.pending.find(p => p.urgent) ?? profile.pending[0];
      let fileId = entry.fileId;
      if (!fileId) {
        const reserved = await allocateFileId(token);
        profile = await this.store(this.id, p => {
          const pending = p.pending.find(item => item.batch.id === entry.batch.id);
          if (pending) pending.fileId ??= reserved;
        });
        fileId = profile.pending.find(p => p.batch.id === entry.batch.id)?.fileId;
        if (!fileId) continue;
      }
      await uploadBatch(token, this.id, fileId, entry.batch);
      profile = await this.store(this.id, p => {
        p.pending = p.pending.filter(item => item.batch.id !== entry.batch.id);
      });
    }
  }

  private async pullChanges(token: string) {
    const files = await listBatches(token, this.id);
    const cached = await this.store(this.id);
    const missing = files.filter(file => !Object.hasOwn(cached.applied, file.name));
    // Bound network concurrency while catching up on a long offline session.
    for (let start = 0; start < missing.length && !this.stopped; start += 10) {
      const batches: Batch[] = await Promise.all(missing.slice(start, start + 10).map(async file => {
        const batch: Batch = JSON.parse(await downloadStateFile(token, file.id));
        if (batch.id !== file.name) throw new Error('Unexpected Drive batch ID');
        return batch;
      }));
      let sessionChanged = false;
      const profile = await this.store(this.id, p => {
        const previous = resumePoint(p.state);
        for (const batch of batches) applyBatch(p, batch);
        const next = resumePoint(p.state);
        sessionChanged = previous?.episode.audioUrl !== next?.episode.audioUrl || previous?.time !== next?.time;
      });
      if (!this.stopped) {
        this.events.state(profile.state);
        if (sessionChanged) this.events.remote(resumePoint(profile.state));
      }
    }
    // Another tab may have already applied all listed batches.
    if (!missing.length && !this.stopped) this.events.state(cached.state);
  }
}
