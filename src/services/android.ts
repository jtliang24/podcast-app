import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Episode } from '../types.ts';
import type { PluginListenerHandle } from '@capacitor/core';

export const isAndroid = Capacitor.getPlatform() === 'android';

export interface AndroidTrack {
  episode: Episode;
  podcastTitle?: string;
  artworkUrl?: string;
  time: number;
}

export interface PlaybackChange {
  episode: Episode;
  time: number;
  duration: number;
  updated: number;
  finished?: boolean;
  selected?: boolean;
  lastPlayed?: number;
}

export interface AndroidPlaybackState {
  episode: Episode | null;
  time: number;
  duration: number;
  playing: boolean;
  error: boolean;
  revision: number;
  changes: PlaybackChange[];
  urgent: boolean;
}

interface PlaybackCommand {
  profile: string;
  action: 'open' | 'snapshot' | 'queue' | 'select' | 'toggle' | 'seek' | 'skip' | 'seekIncrements' | 'acknowledge';
  queue?: AndroidTrack[];
  track?: AndroidTrack;
  autoplay?: boolean;
  time?: number;
  revision?: number;
  updated?: number;
  skipBackwardSeconds?: number;
  skipForwardSeconds?: number;
}

export interface DownloadConnection {
  transport: 'offline' | 'unknown' | 'cellular' | 'other';
  id: string;
}

interface LocalState {
  id: string;
  json: string | null;
  linked: boolean;
  reconnect: boolean;
}

export const AndroidPlayback = registerPlugin<{
  control(command: PlaybackCommand): Promise<AndroidPlaybackState>;
}>('PodcastPlayback');

export const AndroidFiles = registerPlugin<{
  readState(): Promise<LocalState>;
  writeState(options: { id: string; json: string }): Promise<{ reconnect: boolean }>;
  linkState(options: { action: 'open' | 'create' | 'reconnect' }): Promise<LocalState | { cancelled: true }>;
  exportFile(options: { name: string; mimeType: string; content: string; encoding?: 'base64' }): Promise<void>;
  captureScreenshot(): Promise<{ base64: string }>;
}>('PodcastFiles');

export const AndroidDownloads = registerPlugin<{
  download(options: { episode: Episode }): Promise<void>;
  list(): Promise<{ episodes: Episode[] }>;
  remove(options: { id: string }): Promise<void>;
}>('PodcastDownloads');

export const AndroidConnectivity = registerPlugin<{
  getStatus(): Promise<DownloadConnection>;
  addListener(event: 'connectionChange', listener: (connection: DownloadConnection) => void): Promise<PluginListenerHandle>;
}>('PodcastConnectivity');

export const AndroidHttp = registerPlugin<{
  get(options: { url: string; privateFeed?: boolean }): Promise<{ status: number; body: string }>;
}>('PodcastHttp');

export const AndroidDrive = registerPlugin<{
  authorize(options: { interactive: boolean }): Promise<{ token?: string }>;
  clearToken(options: { token: string }): Promise<void>;
}>('PodcastDrive');
