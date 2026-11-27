package io.github.jtliang24.podcastapp;

import android.app.PendingIntent;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private ActivityResultLauncher<IntentSenderRequest> driveConsent;
    private ActivityResultCallback<ActivityResult> driveResult;
    private final OnBackPressedCallback navigationBack = new OnBackPressedCallback(false) {
        @Override
        public void handleOnBackPressed() {
            bridge.triggerWindowJSEvent("podcastBack");
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PodcastPlaybackPlugin.class);
        registerPlugin(PodcastFilesPlugin.class);
        registerPlugin(PodcastDownloadsPlugin.class);
        registerPlugin(PodcastConnectivityPlugin.class);
        registerPlugin(PodcastHttpPlugin.class);
        registerPlugin(PodcastDrivePlugin.class);
        registerPlugin(PodcastNavigationPlugin.class);
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(this, navigationBack);
        if (bridge != null) {
            bridge.addWebViewListener(new WebViewListener() {
                @Override
                public void onPageStarted(WebView view) {
                    navigationBack.setEnabled(false);
                }
            });
        }

        driveConsent = registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), result -> {
            ActivityResultCallback<ActivityResult> callback = driveResult;
            driveResult = null;
            if (callback != null) callback.onActivityResult(result);
        });
    }

    void setNavigationBackEnabled(boolean enabled) {
        navigationBack.setEnabled(enabled);
    }

    boolean authorizeDrive(PendingIntent intent, ActivityResultCallback<ActivityResult> callback) {
        if (driveResult != null || intent == null) return false;
        driveResult = callback;
        try {
            driveConsent.launch(new IntentSenderRequest.Builder(intent).build());
            return true;
        } catch (Exception ignored) {
            driveResult = null;
            return false;
        }
    }
}
