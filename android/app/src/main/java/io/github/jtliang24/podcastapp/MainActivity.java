package io.github.jtliang24.podcastapp;

import android.app.PendingIntent;
import android.os.Bundle;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private ActivityResultLauncher<IntentSenderRequest> driveConsent;
    private ActivityResultCallback<ActivityResult> driveResult;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PodcastPlaybackPlugin.class);
        registerPlugin(PodcastFilesPlugin.class);
        registerPlugin(PodcastDownloadsPlugin.class);
        registerPlugin(PodcastHttpPlugin.class);
        registerPlugin(PodcastDrivePlugin.class);
        super.onCreate(savedInstanceState);

        driveConsent = registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), result -> {
            ActivityResultCallback<ActivityResult> callback = driveResult;
            driveResult = null;
            if (callback != null) callback.onActivityResult(result);
        });
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
