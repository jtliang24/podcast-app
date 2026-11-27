package io.github.jtliang24.podcastapp;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PodcastNavigation")
public class PodcastNavigationPlugin extends Plugin {
    @PluginMethod
    public void setBackEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        MainActivity activity = (MainActivity) getActivity();
        activity.runOnUiThread(() -> {
            activity.setNavigationBackEnabled(enabled);
            call.resolve();
        });
    }
}
