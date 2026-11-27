package io.github.jtliang24.podcastapp;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingSimpleBasePlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.CommandButton;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionResult;
import com.getcapacitor.JSObject;
import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@OptIn(markerClass = UnstableApi.class)
public class PlaybackService extends MediaSessionService {
    static final String LOCAL_BIND = "io.github.jtliang24.podcastapp.PLAYBACK";
    private static final int CHECKPOINT_INTERVAL_MS = 10_000;
    private static final long SLEEP_CHECK_MS = 500;
    private static final long SLEEP_FADE_STEP_MS = 100;
    /** Matches `SLEEP_TIMER_FADE_MS` in `sleepTimer.ts`. */
    private static final long SLEEP_FADE_MS = 10_000;
    private static final SessionCommand SKIP_BACK = new SessionCommand("podcast.skip_back", Bundle.EMPTY);
    private static final SessionCommand SKIP_FORWARD = new SessionCommand("podcast.skip_forward", Bundle.EMPTY);

    final class LocalBinder extends Binder {
        PlaybackService service() {
            return PlaybackService.this;
        }
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Track> queue = new ArrayList<>();
    private final Map<String, JSONObject> pending = new LinkedHashMap<>();
    private final Runnable periodicCheckpoint = new Runnable() {
        @Override
        public void run() {
            if (player.isPlaying()) checkpoint(false);
            main.postDelayed(this, CHECKPOINT_INTERVAL_MS);
        }
    };
    private final Runnable sleepCheck = this::checkSleepTimer;

    private ExoPlayer player;
    private SessionPlayer sessionPlayer;
    private MediaSession session;
    private EpisodeDownloads downloads;
    private SharedPreferences journal;
    private String profile;
    private Track current;
    private long revision;
    private boolean hasPlayed;
    private long lastPlayed;
    private boolean replacing;
    private boolean invalidSource;
    private boolean skipButtonsVisible;
    private boolean autoRemoveFinishedDownloads;
    // The sleep timer runs here because the WebView can be suspended. At most one kind is set, and none survives
    // the service. It mirrors `useSleepTimer` in the web player.
    /** A wall-clock deadline in {@link SystemClock#elapsedRealtime()}, or 0. */
    private long sleepAtElapsed;
    private boolean sleepAtEpisodeEnd;
    /** The media position at which episode {@link #sleepEpisodeId} stops, or -1. Other episodes never stop. */
    private long sleepUntilPositionMs = -1;
    @Nullable private String sleepEpisodeId;
    private boolean sleepFading;
    private long sleepFadeStartedAt;
    private float sleepFadeVolume = 1;

    @Override
    public void onCreate() {
        super.onCreate();
        journal = getSharedPreferences("playback_journal", MODE_PRIVATE);
        downloads = new EpisodeDownloads(this);
        player = new ExoPlayer.Builder(this)
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build();
        sessionPlayer = new SessionPlayer(player);
        PendingIntent launch = PendingIntent.getActivity(this, 0,
            new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        session = new MediaSession.Builder(this, sessionPlayer).setSessionActivity(launch)
            .setCallback(new MediaSession.Callback() {
                @Override
                public MediaSession.ConnectionResult onConnect(MediaSession mediaSession, MediaSession.ControllerInfo controller) {
                    return new MediaSession.ConnectionResult.AcceptedResultBuilder(mediaSession)
                        .setAvailablePlayerCommands(MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS.buildUpon()
                            .remove(Player.COMMAND_CHANGE_MEDIA_ITEMS).remove(Player.COMMAND_SET_MEDIA_ITEM).build())
                        .setAvailableSessionCommands(MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                            .add(SKIP_BACK).add(SKIP_FORWARD).build())
                        .build();
                }

                @Override
                public ListenableFuture<SessionResult> onCustomCommand(MediaSession mediaSession,
                        MediaSession.ControllerInfo controller, SessionCommand command, Bundle args) {
                    boolean backward = SKIP_BACK.equals(command);
                    if (!backward && !SKIP_FORWARD.equals(command)) {
                        return MediaSession.Callback.super.onCustomCommand(mediaSession, controller, command, args);
                    }
                    if (!player.isCommandAvailable(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)) {
                        return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_ERROR_INVALID_STATE));
                    }
                    if (backward) sessionPlayer.seekBack();
                    else sessionPlayer.seekForward();
                    return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
                }
            }).build();
        addSession(session);
        player.addListener(new Player.Listener() {
            @Override
            public void onAvailableCommandsChanged(Player.Commands commands) {
                boolean seekable = commands.contains(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM);
                if (skipButtonsVisible != seekable) {
                    skipButtonsVisible = seekable;
                    updateSkipButtons();
                }
            }

            @Override
            public void onIsPlayingChanged(boolean playing) {
                if (replacing) return;
                if (playing) {
                    hasPlayed = true;
                    lastPlayed = System.currentTimeMillis();
                }
                if (playing || !player.getPlayWhenReady() || player.getPlaybackSuppressionReason() != Player.PLAYBACK_SUPPRESSION_REASON_NONE) {
                    checkpoint(true);
                }
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                if (!playWhenReady && !replacing) {
                    // Pausing mid-fade, from any controller, ends the sleep timer at full volume.
                    if (sleepFading) clearSleepTimer();
                    checkpoint(true);
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (!replacing) checkpoint(true);
            }

            @Override
            public void onPositionDiscontinuity(Player.PositionInfo before, Player.PositionInfo after, int reason) {
                if (!replacing && reason == Player.DISCONTINUITY_REASON_SEEK) {
                    hasPlayed = true;
                    checkpoint(true);
                }
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED) {
                    Track ended = current;
                    main.post(() -> {
                        if (ended != null && ended == current && (hasPlayed || player.getPlayWhenReady())
                                && player.getPlaybackState() == Player.STATE_ENDED) finishEpisode();
                    });
                }
            }
        });
        main.postDelayed(periodicCheckpoint, CHECKPOINT_INTERVAL_MS);
    }

    private void updateSkipButtons() {
        session.setMediaButtonPreferences(skipButtonsVisible ? ImmutableList.of(
            skipButton(true, sessionPlayer.backMs / 1000),
            skipButton(false, sessionPlayer.forwardMs / 1000)
        ) : ImmutableList.of());
    }

    private static CommandButton skipButton(boolean backward, long seconds) {
        int icon = switch ((int) seconds) {
            case 10 -> backward ? CommandButton.ICON_SKIP_BACK_10 : CommandButton.ICON_SKIP_FORWARD_10;
            case 15 -> backward ? CommandButton.ICON_SKIP_BACK_15 : CommandButton.ICON_SKIP_FORWARD_15;
            case 30 -> backward ? CommandButton.ICON_SKIP_BACK_30 : CommandButton.ICON_SKIP_FORWARD_30;
            default -> backward ? CommandButton.ICON_SKIP_BACK : CommandButton.ICON_SKIP_FORWARD;
        };
        return new CommandButton.Builder(icon)
            .setDisplayName("Skip " + (backward ? "back " : "forward ") + seconds + " seconds")
            .setSessionCommand(backward ? SKIP_BACK : SKIP_FORWARD)
            .setSlots(backward ? CommandButton.SLOT_BACK : CommandButton.SLOT_FORWARD)
            .build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        if (LOCAL_BIND.equals(intent.getAction())) return new LocalBinder();
        return super.onBind(intent);
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controller) {
        return session;
    }

    @Override
    public void onDestroy() {
        if (player.isPlaying()) checkpoint(false);
        main.removeCallbacksAndMessages(null);
        replacing = true;
        session.release();
        sessionPlayer.release();
        super.onDestroy();
    }

    JSObject control(String requestedProfile, String action, JSONObject options) throws JSONException {
        if ("open".equals(action)) {
            if (!requestedProfile.equals(profile)) open(requestedProfile, options);
            setPreferences(options);
        } else {
            if (!requestedProfile.equals(profile)) throw new IllegalStateException("The playback library has changed");
            switch (action) {
                case "snapshot":
                    break;
                case "queue":
                    setQueue(options.optJSONArray("queue"));
                    break;
                case "select":
                    checkpoint(true);
                    select(Track.from(options.getJSONObject("track")), options.optBoolean("autoplay"));
                    recordSelection();
                    break;
                case "toggle":
                    toggle();
                    break;
                case "skip":
                    seek(position() + milliseconds(options.getDouble("time")));
                    break;
                case "seek":
                    seek(milliseconds(options.getDouble("time")));
                    break;
                case "preferences":
                    setPreferences(options);
                    break;
                case "speed":
                    setSpeed(options.optString("episodeId"), options.optDouble("playbackSpeed", 1));
                    break;
                case "sleep":
                    setSleepTimer(options);
                    break;
                case "acknowledge":
                    long acknowledged = options.getLong("revision");
                    for (Iterator<JSONObject> changes = pending.values().iterator(); changes.hasNext();) {
                        if (changes.next().optLong("revision") <= acknowledged) changes.remove();
                    }
                    saveJournal();
                    break;
                default:
                    throw new IllegalArgumentException("Unknown playback action");
            }
        }
        return snapshot();
    }

    private void setPreferences(JSONObject options) {
        sessionPlayer.setSeekIncrements(options);
        autoRemoveFinishedDownloads = options.optBoolean("autoRemoveFinishedDownloads");
    }

    /** Changes the current track's speed without reloading it. A stale request for another episode is ignored. */
    private void setSpeed(String episodeId, double speed) {
        if (current == null || !current.id().equals(episodeId)) return;
        current = current.at(current.position, Track.speed(speed));
        player.setPlaybackSpeed((float) current.speed);
    }

    /**
     * Handles the `sleep` action. `time` takes `minutes` of wall-clock time, `episode` stops at the end of the
     * current episode, `position` stops episode `episodeId` at media position `until` in seconds, and `off` cancels.
     * `extend` pushes the running timer back by `extendMs`, like `extend()` in `sleepTimer.ts`.
     */
    private void setSleepTimer(JSONObject options) throws JSONException {
        String mode = options.getString("mode");
        if ("extend".equals(mode)) {
            extendSleepTimer(options.getLong("extendMs"));
            return;
        }
        clearSleepTimer();
        switch (mode) {
            case "time" -> {
                double minutes = options.getDouble("minutes");
                if (!(minutes > 0)) throw new IllegalArgumentException("Invalid sleep timer duration");
                sleepAtElapsed = SystemClock.elapsedRealtime() + Math.round(minutes * 60_000);
            }
            case "episode" -> sleepAtEpisodeEnd = true;
            case "position" -> {
                sleepUntilPositionMs = Math.max(0, milliseconds(options.getDouble("until")));
                sleepEpisodeId = options.getString("episodeId");
            }
            case "off" -> { }
            default -> throw new IllegalArgumentException("Unknown sleep timer mode");
        }
        scheduleSleepCheck();
    }

    /**
     * A `time` timer that already ran out, for example while fading, extends from now. A `position` timer moves by
     * `ms` of media time. An `episode` timer doesn't change.
     */
    private void extendSleepTimer(long ms) {
        if (sleepAtElapsed != 0) {
            sleepAtElapsed = Math.max(sleepAtElapsed, SystemClock.elapsedRealtime()) + ms;
        } else if (sleepUntilPositionMs >= 0) {
            sleepUntilPositionMs += ms;
        } else {
            return;
        }
        stopSleepFade();
        scheduleSleepCheck();
    }

    /** Ends the sleep timer, putting the volume back if it was fading. */
    private void clearSleepTimer() {
        stopSleepFade();
        sleepAtElapsed = 0;
        sleepAtEpisodeEnd = false;
        sleepUntilPositionMs = -1;
        sleepEpisodeId = null;
        main.removeCallbacks(sleepCheck);
    }

    private void stopSleepFade() {
        if (!sleepFading) return;
        sleepFading = false;
        player.setVolume(sleepFadeVolume);
    }

    /** Checks while a timer needs watching. "End of episode" doesn't, because {@link #finishEpisode()} handles it. */
    private void scheduleSleepCheck() {
        main.removeCallbacks(sleepCheck);
        if (sleepFading || sleepAtElapsed != 0 || sleepUntilPositionMs >= 0) {
            main.postDelayed(sleepCheck, sleepFading ? SLEEP_FADE_STEP_MS : SLEEP_CHECK_MS);
        }
    }

    private boolean sleepTimerExpired(long now) {
        return (sleepAtElapsed != 0 && now >= sleepAtElapsed) || (sleepUntilPositionMs >= 0 && current != null
            && current.id().equals(sleepEpisodeId) && position() >= sleepUntilPositionMs);
    }

    /**
     * When the timer runs out, fades the volume out over {@link #SLEEP_FADE_MS}, then pauses through the normal
     * pause path, so progress is saved as for a user pause, and puts the volume back. Timers that run out while
     * paused just end.
     */
    private void checkSleepTimer() {
        long now = SystemClock.elapsedRealtime();
        if (sleepFading) {
            if (current == null || !player.getPlayWhenReady()) {
                clearSleepTimer();
                return;
            }
            float progress = (now - sleepFadeStartedAt) / (float) SLEEP_FADE_MS;
            if (progress >= 1) {
                float volume = sleepFadeVolume;
                // Clear the fade first, so the pause below isn't taken for a pause mid-fade.
                sleepFading = false;
                clearSleepTimer();
                player.pause();
                player.setVolume(volume);
                return;
            }
            player.setVolume(sleepFadeVolume * (1 - progress));
        } else if (sleepTimerExpired(now)) {
            if (current == null || !player.getPlayWhenReady()) {
                clearSleepTimer();
                return;
            }
            sleepFading = true;
            sleepFadeStartedAt = now;
            sleepFadeVolume = player.getVolume();
        }
        scheduleSleepCheck();
    }

    /**
     * Called when an episode ends. Returns whether the next episode should load paused: for "end of episode", a
     * timer fading out or already run out, or a `position` timer on the finished episode. Those timers are cleared.
     */
    private boolean endSleepTimerWithEpisode(String episodeId) {
        boolean stop = sleepAtEpisodeEnd || sleepFading
            || (sleepAtElapsed != 0 && SystemClock.elapsedRealtime() >= sleepAtElapsed)
            || (sleepUntilPositionMs >= 0 && episodeId.equals(sleepEpisodeId));
        if (stop) clearSleepTimer();
        return stop;
    }

    private JSObject sleepSnapshot() {
        JSObject sleep = new JSObject();
        if (sleepAtElapsed != 0) {
            return sleep.put("mode", "time").put("remainingMs", Math.max(0, sleepAtElapsed - SystemClock.elapsedRealtime()));
        }
        if (sleepAtEpisodeEnd) return sleep.put("mode", "episode");
        if (sleepUntilPositionMs >= 0) {
            return sleep.put("mode", "position").put("until", sleepUntilPositionMs / 1000.0).put("episodeId", sleepEpisodeId);
        }
        return sleep.put("mode", "off");
    }

    private final class SessionPlayer extends ForwardingSimpleBasePlayer {
        private long backMs = 15_000;
        private long forwardMs = 30_000;

        SessionPlayer(Player player) {
            super(player);
        }

        void setSeekIncrements(JSONObject options) {
            long back = seekIncrement(options.optInt("skipBackwardSeconds"), 15_000);
            long forward = seekIncrement(options.optInt("skipForwardSeconds"), 30_000);
            if (back == backMs && forward == forwardMs) return;
            backMs = back;
            forwardMs = forward;
            invalidateState();
            updateSkipButtons();
        }

        private long seekIncrement(int seconds, long fallback) {
            return switch (seconds) {
                case 10, 15, 30, 60 -> seconds * 1000L;
                default -> fallback;
            };
        }

        @Override
        protected State getState() {
            return super.getState().buildUpon()
                .setSeekBackIncrementMs(backMs).setSeekForwardIncrementMs(forwardMs).build();
        }

        @Override
        protected ListenableFuture<?> handleSeek(int mediaItemIndex, long positionMs, int command) {
            if (command == Player.COMMAND_SEEK_BACK) {
                seek(position() - backMs);
            } else if (command == Player.COMMAND_SEEK_FORWARD) {
                seek(position() + forwardMs);
            } else {
                return super.handleSeek(mediaItemIndex, positionMs, command);
            }
            return Futures.immediateVoidFuture();
        }
    }

    private void open(String requestedProfile, JSONObject options) throws JSONException {
        checkpoint(true);
        select(null, false);
        profile = requestedProfile;
        pending.clear();
        revision = 0;
        Track restore = Track.from(options.optJSONObject("track"));
        String stored = journal.getString(profile, null);
        if (stored != null) {
            JSONObject saved = new JSONObject(stored);
            JSONArray changes = saved.getJSONArray("changes");
            for (int i = 0; i < changes.length(); i++) {
                JSONObject change = changes.getJSONObject(i);
                pending.put(changeKey(change.getJSONObject("episode"), change.optBoolean("finished")), change);
                revision = Math.max(revision, change.getLong("revision"));
            }
            Track nativeTrack = Track.from(saved.optJSONObject("track"));
            if (restore == null || latestUpdate() >= options.optLong("updated")) restore = nativeTrack;
        }
        setQueue(options.optJSONArray("queue"));
        select(restore, false);
    }

    private long latestUpdate() {
        long latest = 0;
        for (JSONObject change : pending.values()) latest = Math.max(latest, change.optLong("updated"));
        return latest;
    }

    private void setQueue(@Nullable JSONArray tracks) {
        queue.clear();
        if (tracks == null) return;
        for (int i = 0; i < tracks.length(); i++) {
            Track track = Track.from(tracks.optJSONObject(i));
            if (track == null || (current != null && current.id().equals(track.id()))) continue;
            JSONObject progress = pending.get(changeKey(track.episode, false));
            if (pending.containsKey(changeKey(track.episode, true)) || (progress != null && progress.optBoolean("selected"))) continue;
            queue.add(track);
        }
    }

    private void select(@Nullable Track track, boolean autoplay) {
        // Changing tracks mid-fade ends the sleep timer at full volume, as pausing does.
        if (sleepFading) clearSleepTimer();
        replacing = true;
        try {
            player.pause();
            current = track;
            hasPlayed = false;
            lastPlayed = 0;
            invalidSource = false;
            if (track == null) {
                player.clearMediaItems();
                return;
            }
            queue.removeIf(waiting -> waiting.id().equals(track.id()));
            player.setPlaybackSpeed((float) track.speed);

            File file = downloads.audio(track.episode.optString("id"));
            Uri uri;
            try {
                uri = file != null ? Uri.fromFile(file)
                    : Uri.parse(NativeRequests.httpsUri(track.episode.optString("audioUrl")).toString());
            } catch (IllegalArgumentException ignored) {
                invalidSource = true;
                player.clearMediaItems();
                return;
            }
            MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                .setTitle(track.episode.optString("title")).setArtist(track.data.optString("podcastTitle"));
            try {
                metadata.setArtworkUri(Uri.parse(NativeRequests.httpsUri(track.data.optString("artworkUrl")).toString()));
            } catch (IllegalArgumentException ignored) {
                // The episode is playable without remote artwork.
            }
            player.setMediaItem(new MediaItem.Builder().setUri(uri)
                .setMediaId(track.episode.optString("id")).setMediaMetadata(metadata.build()).build(), track.position);
            player.prepare();
        } finally {
            replacing = false;
        }
        if (autoplay) player.play();
    }

    private void toggle() {
        if (current == null) return;
        if (invalidSource || player.getPlayerError() != null) {
            select(current.at(position()), true);
        } else if (player.getPlayWhenReady()) {
            player.pause();
        } else {
            player.play();
        }
    }

    private void seek(long time) {
        if (current == null || invalidSource) return;
        long duration = length();
        player.seekTo(Math.max(0, duration > 0 ? Math.min(time, duration) : time));
    }

    private long position() {
        if (current == null) return 0;
        return invalidSource ? current.position : player.getCurrentPosition();
    }

    private long length() {
        if (current == null) return 0;
        long duration = player.getDuration();
        return duration == C.TIME_UNSET ? milliseconds(current.episode.optDouble("duration", 0)) : duration;
    }

    private void finishEpisode() {
        Track finished = current;
        long duration = length();
        pending.remove(changeKey(finished.episode, false));
        Track next = queue.isEmpty() ? null : queue.get(0);
        // A sleep timer that ends here lets the queue advance but loads the next episode paused.
        boolean sleepNow = endSleepTimerWithEpisode(finished.id());
        select(next, next != null && !sleepNow);
        if (autoRemoveFinishedDownloads) {
            try {
                downloads.finishDownload(finished.id());
            } catch (IOException exception) {
                Log.w("PodcastPlayback", "Could not remove a finished download", exception);
            }
        }
        record(finished, duration, duration, true, true);
        recordSelection();
    }

    private void checkpoint(boolean urgent) {
        if (current != null && hasPlayed && player.getPlaybackState() != Player.STATE_ENDED) {
            record(current, position(), length(), false, urgent);
        }
    }

    private void record(Track track, long time, long duration, boolean finished, boolean urgent) {
        record(track, time, duration, finished, urgent, false);
    }

    private void recordSelection() {
        if (current != null) record(current, position(), length(), false, true, true);
    }

    private void record(Track track, long time, long duration, boolean finished, boolean urgent, boolean selected) {
        String key = changeKey(track.episode, finished);
        JSONObject previous = pending.remove(key);
        boolean urgentChange = urgent || (previous != null && previous.optBoolean("urgent"));
        long updated = System.currentTimeMillis();
        JSONObject change = new JSObject().put("episode", track.episode)
            .put("time", time / 1000.0).put("duration", duration / 1000.0)
            .put("updated", updated).put("finished", finished)
            .put("downloadCleanup", finished && autoRemoveFinishedDownloads)
            .put("selected", selected || (previous != null && previous.optBoolean("selected")))
            .put("lastPlayed", finished ? updated : lastPlayed)
            .put("urgent", urgentChange).put("revision", ++revision);
        pending.put(key, change);
        saveJournal();
    }

    private static String changeKey(JSONObject episode, boolean finished) {
        return (finished ? "finished:" : "progress:") + episode.optString("audioUrl");
    }

    private void saveJournal() {
        if (profile == null) return;
        SharedPreferences.Editor edit = journal.edit();
        if (pending.isEmpty()) {
            edit.remove(profile);
        } else {
            edit.putString(profile, new JSObject().put("changes", new JSONArray(pending.values()))
                .put("track", current == null ? JSONObject.NULL : current.at(position()).data).toString());
        }
        edit.apply();
    }

    private JSObject snapshot() {
        boolean urgent = false;
        for (JSONObject change : pending.values()) urgent |= change.optBoolean("urgent");
        return new JSObject().put("episode", current == null ? JSONObject.NULL : current.episode)
            .put("time", position() / 1000.0).put("duration", length() / 1000.0)
            .put("playing", player.isPlaying()).put("error", invalidSource || player.getPlayerError() != null)
            .put("changes", new JSONArray(pending.values())).put("revision", revision).put("urgent", urgent)
            .put("sleep", sleepSnapshot());
    }

    private static long milliseconds(double seconds) {
        return Math.round(seconds * 1000);
    }

    private static final class Track {
        private static final double MIN_SPEED = 0.5;
        private static final double MAX_SPEED = 3;

        final JSObject data;
        final JSONObject episode;
        final long position;
        final double speed;

        private Track(JSObject data, JSONObject episode, long position, double speed) {
            this.data = data;
            this.episode = episode;
            this.position = position;
            this.speed = speed;
        }

        static Track from(@Nullable JSONObject data) {
            if (data == null || data.optJSONObject("episode") == null) return null;
            double speed = speed(data.optDouble("playbackSpeed", 1));
            JSObject track = new JSObject().put("episode", data.optJSONObject("episode"))
                .put("time", data.optDouble("time", 0)).put("artworkUrl", data.optString("artworkUrl"))
                .put("podcastTitle", data.optString("podcastTitle")).put("playbackSpeed", speed);
            return new Track(track, data.optJSONObject("episode"), Math.max(0, milliseconds(data.optDouble("time", 0))), speed);
        }

        static double speed(double value) {
            return Double.isNaN(value) ? 1 : Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
        }

        Track at(long time) {
            return at(time, speed);
        }

        Track at(long time, double speed) {
            return new Track(new JSObject().put("episode", episode).put("time", time / 1000.0)
                .put("artworkUrl", data.optString("artworkUrl")).put("podcastTitle", data.optString("podcastTitle"))
                .put("playbackSpeed", speed), episode, time, speed);
        }

        String id() {
            return episode.optString("id");
        }
    }
}
