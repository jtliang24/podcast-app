package io.github.jtliang24.podcastapp;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
        downloads.execute(() -> {
            try {
                storage.download(call.getObject("episode"));
                call.resolve();
            } catch (Exception ignored) {
                call.reject("Could not download this episode.");
            }
        });
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
    protected void handleOnDestroy() {
        downloads.shutdownNow();
    }
}
