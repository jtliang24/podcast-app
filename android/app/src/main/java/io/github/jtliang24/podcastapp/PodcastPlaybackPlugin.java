package io.github.jtliang24.podcastapp;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "PodcastPlayback")
public class PodcastPlaybackPlugin extends Plugin implements ServiceConnection {
    private final List<PluginCall> waiting = new ArrayList<>();
    private PlaybackService service;
    private boolean binding;

    @PluginMethod
    public void control(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            if (service != null) {
                dispatch(call);
                return;
            }
            waiting.add(call);
            if (!binding) {
                Intent intent = new Intent(getContext(), PlaybackService.class).setAction(PlaybackService.LOCAL_BIND);
                binding = getContext().bindService(intent, this, Context.BIND_AUTO_CREATE);
                if (!binding) failWaiting();
            }
        });
    }

    @Override
    public void onServiceConnected(ComponentName name, IBinder binder) {
        service = ((PlaybackService.LocalBinder) binder).service();
        for (PluginCall call : waiting) dispatch(call);
        waiting.clear();
    }

    @Override
    public void onServiceDisconnected(ComponentName name) {
        service = null;
    }

    @Override
    public void onBindingDied(ComponentName name) {
        disconnect();
    }

    @Override
    public void onNullBinding(ComponentName name) {
        disconnect();
    }

    private void dispatch(PluginCall call) {
        try {
            call.resolve(service.control(call.getString("profile"), call.getString("action"), call.getData()));
        } catch (Exception ignored) {
            // Some player exceptions include the enclosure URL.
            call.reject("Android playback is unavailable.");
        }
    }

    private void failWaiting() {
        for (PluginCall call : waiting) call.reject("Could not connect to the Android playback service.");
        waiting.clear();
    }

    private void disconnect() {
        if (binding) getContext().unbindService(this);
        binding = false;
        service = null;
        failWaiting();
    }

    @Override
    protected void handleOnDestroy() {
        disconnect();
    }
}
