import type { AppState } from '../types.ts';
import type { AndroidPlaybackState } from './android.ts';
import { recordPodcastPlay } from './subscriptionSort.ts';

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
    if (change.finished) {
      delete playbackProgress[audioUrl];
      queue = queue.filter(episode => episode.id !== id);
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
  if (episode && !keepExisting && queue[0]?.id !== episode.id) {
    queue = [episode, ...queue.filter(item => item.id !== episode.id)];
  }
  return { ...state, playbackProgress, playedEpisodes, podcastLastPlayed, queue, lastPlayingEpisode: episode };
}
