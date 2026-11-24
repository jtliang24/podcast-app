package io.github.jtliang24.podcastapp;

import android.content.Context;
import android.os.SystemClock;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class EpisodeDownloads {
    private static final Object FILES = new Object();
    private static final Set<DownloadAttempt> ACTIVE = new HashSet<>();

    private final File root;

    EpisodeDownloads(Context context) {
        root = new File(context.getFilesDir(), "episodes");
    }

    private File directory(String id) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(id.getBytes(StandardCharsets.UTF_8));
            StringBuilder key = new StringBuilder();
            for (byte value : digest) key.append(Character.forDigit((value >>> 4) & 15, 16))
                .append(Character.forDigit(value & 15, 16));
            return new File(root, key.toString());
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    File audio(String id) {
        synchronized (FILES) {
            File audio = new File(directory(id), "audio");
            return audio.isFile() ? audio : null;
        }
    }

    DownloadAttempt beginDownload(JSONObject episode) throws JSONException {
        DownloadAttempt attempt = new DownloadAttempt(episode, episode.getString("id"));
        synchronized (FILES) {
            ACTIVE.add(attempt);
        }
        return attempt;
    }

    void endDownload(DownloadAttempt attempt) {
        synchronized (FILES) {
            ACTIVE.remove(attempt);
        }
    }

    void download(DownloadAttempt attempt) throws Exception {
        String id = attempt.id;
        JSONObject episode = attempt.episode;
        synchronized (FILES) {
            if (attempt.discard || audio(id) != null) return;
        }
        if (!root.isDirectory() && !root.mkdirs() && !root.isDirectory()) throw new IOException("Storage unavailable");
        File temporary = File.createTempFile("audio-", ".part", root);
        HttpURLConnection connection = null;
        try {
            long deadline = SystemClock.elapsedRealtime() + 30 * 60_000;
            connection = NativeRequests.open(episode.getString("audioUrl"), false, "audio/*, */*", deadline);
            if (connection.getResponseCode() != 200) throw new IOException("Download rejected");
            String contentType = connection.getContentType();
            if (contentType != null && contentType.toLowerCase(Locale.ROOT).startsWith("text/html")) {
                throw new IOException("Expected an audio file");
            }
            long received = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[64 * 1024];
                for (int count; (count = input.read(buffer)) != -1;) {
                    if (Thread.currentThread().isInterrupted() || SystemClock.elapsedRealtime() >= deadline) {
                        throw new IOException("Download interrupted");
                    }
                    output.write(buffer, 0, count);
                    received += count;
                }
                output.getFD().sync();
            }
            String expected = connection.getHeaderField("Content-Length");
            if (received == 0 || (expected != null && received != Long.parseLong(expected))) {
                throw new IOException("Incomplete download");
            }
            synchronized (FILES) {
                if (attempt.discard || audio(id) != null) return;
                File directory = directory(id);
                if (!directory.isDirectory() && !directory.mkdir()) throw new IOException("Storage unavailable");
                PrivateFiles.write(new AtomicFile(new File(directory, "episode.json")), episode.toString());
                if (!temporary.renameTo(new File(directory, "audio"))) throw new IOException("Could not save audio");
            }
        } finally {
            if (connection != null) connection.disconnect();
            temporary.delete();
        }
    }

    void finishDownload(String id) throws IOException {
        synchronized (FILES) {
            for (DownloadAttempt attempt : ACTIVE) {
                if (attempt.id.equals(id)) attempt.discard = true;
            }
            remove(id);
        }
    }

    JSONArray list() {
        JSONArray episodes = new JSONArray();
        synchronized (FILES) {
            File[] directories = root.listFiles(File::isDirectory);
            if (directories == null) return episodes;
            for (File directory : directories) {
                if (!new File(directory, "audio").isFile()) continue;
                try {
                    episodes.put(new JSONObject(PrivateFiles.read(new AtomicFile(new File(directory, "episode.json")))));
                } catch (Exception ignored) {
                    // An unreadable record does not prevent using the rest of the downloads.
                }
            }
        }
        return episodes;
    }

    void remove(String id) throws IOException {
        synchronized (FILES) {
            File directory = directory(id);
            File audio = new File(directory, "audio");
            if (audio.exists() && !audio.delete()) throw new IOException("Could not delete audio");
            new AtomicFile(new File(directory, "episode.json")).delete();
            directory.delete();
        }
    }

    static final class DownloadAttempt {
        final JSONObject episode;
        final String id;
        boolean discard;

        DownloadAttempt(JSONObject episode, String id) {
            this.episode = episode;
            this.id = id;
        }
    }
}
