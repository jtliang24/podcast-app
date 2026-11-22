package io.github.jtliang24.podcastapp;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Binder;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
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
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import com.getcapacitor.JSObject;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.File;
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
                        .build();
                }
            }).build();
        addSession(session);
        player.addListener(new Player.Listener() {
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
                if (!playWhenReady && !replacing) checkpoint(true);
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
            sessionPlayer.setSeekIncrements(options);
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
                case "seekIncrements":
                    sessionPlayer.setSeekIncrements(options);
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
        select(next, next != null);
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
            .put("changes", new JSONArray(pending.values())).put("revision", revision).put("urgent", urgent);
    }

    private static long milliseconds(double seconds) {
        return Math.round(seconds * 1000);
    }

    private static final class Track {
        final JSObject data;
        final JSONObject episode;
        final long position;

        private Track(JSObject data, JSONObject episode, long position) {
            this.data = data;
            this.episode = episode;
            this.position = position;
        }

        static Track from(@Nullable JSONObject data) {
            if (data == null || data.optJSONObject("episode") == null) return null;
            JSObject track = new JSObject().put("episode", data.optJSONObject("episode"))
                .put("time", data.optDouble("time", 0)).put("artworkUrl", data.optString("artworkUrl"))
                .put("podcastTitle", data.optString("podcastTitle"));
            return new Track(track, data.optJSONObject("episode"), Math.max(0, milliseconds(data.optDouble("time", 0))));
        }

        Track at(long time) {
            return new Track(new JSObject().put("episode", episode).put("time", time / 1000.0)
                .put("artworkUrl", data.optString("artworkUrl")).put("podcastTitle", data.optString("podcastTitle")), episode, time);
        }

        String id() {
            return episode.optString("id");
        }
    }
}
