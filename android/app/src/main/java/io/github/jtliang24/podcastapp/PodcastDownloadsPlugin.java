package io.github.jtliang24.podcastapp;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import org.json.JSONException;

@CapacitorPlugin(name = "PodcastDownloads")
public class PodcastDownloadsPlugin extends Plugin {
    private final ExecutorService downloads = Executors.newFixedThreadPool(2);
    private EpisodeDownloads storage;

    @Override
    public void load() {
        storage = new EpisodeDownloads(getContext());
    }

    @PluginMethod
    public void download(PluginCall call) {
        EpisodeDownloads.DownloadAttempt attempt;
        try {
            attempt = storage.beginDownload(call.getObject("episode", new JSObject()));
        } catch (JSONException ignored) {
            call.reject("Could not download this episode.");
            return;
        }
        try {
            downloads.execute(new DownloadTask(attempt, call));
        } catch (RejectedExecutionException ignored) {
            storage.endDownload(attempt);
            call.reject("Could not download this episode.");
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        call.resolve(new JSObject().put("episodes", storage.list()));
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            storage.remove(call.getString("id"));
            call.resolve();
        } catch (IOException ignored) {
            call.reject("Could not remove this download.");
        }
    }

    @Override
    protected void handleOnResume() {
        notifyListeners("resume", new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        for (Runnable waiting : downloads.shutdownNow()) {
            storage.endDownload(((DownloadTask) waiting).attempt);
        }
    }

    private final class DownloadTask implements Runnable {
        final EpisodeDownloads.DownloadAttempt attempt;
        final PluginCall call;

        DownloadTask(EpisodeDownloads.DownloadAttempt attempt, PluginCall call) {
            this.attempt = attempt;
            this.call = call;
        }

        @Override
        public void run() {
            try {
                storage.download(attempt);
                call.resolve();
            } catch (Exception ignored) {
                call.reject("Could not download this episode.");
            } finally {
                storage.endDownload(attempt);
            }
        }
    }
}
