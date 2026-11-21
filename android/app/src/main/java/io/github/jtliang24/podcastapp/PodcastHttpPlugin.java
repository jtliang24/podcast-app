package io.github.jtliang24.podcastapp;

import android.os.SystemClock;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "PodcastHttp")
public class PodcastHttpPlugin extends Plugin {
    private final ExecutorService requests = Executors.newFixedThreadPool(4);

    @PluginMethod
    public void get(PluginCall call) {
        requests.execute(() -> {
            boolean privateFeed = Boolean.TRUE.equals(call.getBoolean("privateFeed"));
            long deadline = SystemClock.elapsedRealtime() + (privateFeed ? 30_000 : 10_000);
            HttpURLConnection connection = null;
            try {
                connection = NativeRequests.open(call.getString("url"), privateFeed,
                    "application/rss+xml, application/xml, text/xml, application/json", deadline);
                int status = connection.getResponseCode();
                String body = "";
                if (status >= 200 && status < 300) {
                    try (InputStream input = connection.getInputStream()) {
                        body = NativeRequests.readText(input, 16 * 1024 * 1024, deadline);
                    }
                }
                call.resolve(new JSObject().put("status", status).put("body", body));
            } catch (Exception ignored) {
                // Transport exceptions may contain the private URL.
                call.reject("Could not fetch the requested resource.");
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        requests.shutdownNow();
    }
}
