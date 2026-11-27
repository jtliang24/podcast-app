import type { AppState, Episode } from '../types.ts';
import type { AndroidPlaybackState, AndroidTrack } from './android.ts';
import { resumePoint } from './driveSync.ts';
import { getPreferences } from './preferences.ts';
import { recordPodcastPlay } from './subscriptionSort.ts';
import { orderedQueue, removeQueuedEpisode } from './playbackQueue.ts';

export function androidPlaybackTrack(state: AppState, episode: Episode,
  time = state.playbackProgress[episode.audioUrl]?.currentTime ?? 0): AndroidTrack {
  const podcast = state.subscriptions.find(p => p.feedUrl === episode.podcastId);
  return { episode, time, podcastTitle: podcast?.title, artworkUrl: podcast?.artworkUrl };
}

export function androidPlaybackQueue(state: AppState) {
  return orderedQueue(state.queue).map(episode => androidPlaybackTrack(state, episode));
}

export function androidPlaybackOpen(state: AppState) {
  const point = resumePoint(state);
  const { skipBackwardSeconds, skipForwardSeconds, autoRemoveFinishedDownloads } = getPreferences(state);
  return {
    action: 'open' as const,
    track: point ? androidPlaybackTrack(state, point.episode, point.time) : undefined,
    updated: point ? state.playbackProgress[point.episode.audioUrl]?.lastUpdated : undefined,
    queue: androidPlaybackQueue(state),
    skipBackwardSeconds,
    skipForwardSeconds,
    autoRemoveFinishedDownloads,
  };
}

export function applyAndroidPlayback(state: AppState, playback: AndroidPlaybackState): AppState {
  if (!playback.changes.length) return state;
  const playbackProgress = { ...state.playbackProgress };
  const playedEpisodes = { ...state.playedEpisodes };
  let podcastLastPlayed = state.podcastLastPlayed;
  let queue = state.queue;
  let latest = 0;

  for (const change of playback.changes) {
    const { audioUrl, id } = change.episode;
    const lastPlayed = change.lastPlayed ?? (change.finished ? change.updated : 0);
    if (change.episode.podcastId) podcastLastPlayed = recordPodcastPlay(podcastLastPlayed, change.episode.podcastId, lastPlayed);
    latest = Math.max(latest, change.updated);
    if (change.finished) playedEpisodes[id] = true;
    const previous = playbackProgress[audioUrl];
    if (previous?.lastUpdated > change.updated) continue;
    if (change.finished || (change.selected && previous?.lastUpdated !== change.updated)) {
      queue = removeQueuedEpisode(queue, id);
    }
    if (change.finished) {
      delete playbackProgress[audioUrl];
    } else if (previous?.lastUpdated !== change.updated || previous.currentTime !== change.time
      || previous.duration !== change.duration) {
      playbackProgress[audioUrl] = {
        episodeUrl: audioUrl,
        currentTime: change.time,
        duration: change.duration,
        lastUpdated: change.updated,
      };
    }
  }

  const existing = state.lastPlayingEpisode;
  const keepExisting = existing && state.playbackProgress[existing.audioUrl]?.lastUpdated > latest;
  const episode = keepExisting ? existing : playback.episode;
  if (episode) queue = removeQueuedEpisode(queue, episode.id);
  return { ...state, playbackProgress, playedEpisodes, podcastLastPlayed, queue, lastPlayingEpisode: episode };
}
