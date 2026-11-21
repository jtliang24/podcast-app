package io.github.jtliang24.podcastapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PodcastConnectivity")
public class PodcastConnectivityPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private ConnectivityManager connectivity;
    private final BroadcastReceiver legacyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            publish();
        }
    };
    private final ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
        @Override
        public void onAvailable(Network network) {
            publish();
        }

        @Override
        public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
            publish();
        }

        @Override
        public void onLost(Network network) {
            publish();
        }
    };

    @Override
    @SuppressWarnings("deprecation") // API 23 does not have a default network callback.
    public void load() {
        connectivity = getContext().getSystemService(ConnectivityManager.class);
        if (connectivity == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            connectivity.registerDefaultNetworkCallback(callback);
        } else {
            getContext().registerReceiver(legacyReceiver, new IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION));
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        main.post(() -> call.resolve(status()));
    }

    @Override
    protected void handleOnResume() {
        publish();
    }

    @Override
    protected void handleOnDestroy() {
        if (connectivity != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) connectivity.unregisterNetworkCallback(callback);
            else getContext().unregisterReceiver(legacyReceiver);
        }
        main.removeCallbacksAndMessages(null);
    }

    private void publish() {
        main.post(() -> notifyListeners("connectionChange", status()));
    }

    private JSObject status() {
        if (connectivity == null) return new JSObject().put("transport", "unknown").put("id", "");
        Network network = connectivity.getActiveNetwork();
        NetworkCapabilities capabilities = network == null ? null : connectivity.getNetworkCapabilities(network);
        if (capabilities == null) return new JSObject().put("transport", "offline").put("id", "");
        String transport = "unknown";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
            transport = "other";
        } else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
            transport = "cellular";
        }
        return new JSObject().put("transport", transport).put("id", Long.toString(network.getNetworkHandle()));
    }
}
