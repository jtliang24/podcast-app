package io.github.jtliang24.podcastapp;

import android.app.Activity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.Scopes;
import com.google.android.gms.common.api.Scope;
import java.util.Collections;

@CapacitorPlugin(name = "PodcastDrive")
public class PodcastDrivePlugin extends Plugin {
    @PluginMethod
    public void authorize(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            MainActivity activity = (MainActivity) getActivity();
            AuthorizationClient client = Identity.getAuthorizationClient(activity);
            boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive"));
            AuthorizationRequest.Builder request = AuthorizationRequest.builder()
                .setRequestedScopes(Collections.singletonList(new Scope(Scopes.DRIVE_APPFOLDER)));
            if (interactive) request.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT);
            client.authorize(request.build()).addOnSuccessListener(activity, result -> {
                if (!result.hasResolution()) {
                    resolveToken(call, result);
                } else if (!interactive) {
                    call.resolve();
                } else if (!activity.authorizeDrive(result.getPendingIntent(), response -> {
                    if (response.getResultCode() != Activity.RESULT_OK) {
                        call.resolve();
                        return;
                    }
                    try {
                        resolveToken(call, client.getAuthorizationResultFromIntent(response.getData()));
                    } catch (Exception ignored) {
                        call.reject("Google Drive authorization failed.");
                    }
                })) {
                    call.reject("Google Drive authorization is already open.");
                }
            }).addOnFailureListener(activity, ignored -> call.reject("Google Drive authorization is unavailable."));
        });
    }

    private static void resolveToken(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null || !result.getGrantedScopes().contains(new Scope(Scopes.DRIVE_APPFOLDER))) {
            call.reject("Google Drive access was not granted.");
        } else {
            call.resolve(new JSObject().put("token", token));
        }
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        Identity.getAuthorizationClient(getActivity())
            .clearToken(ClearTokenRequest.builder().setToken(call.getString("token")).build())
            .addOnSuccessListener(ignored -> call.resolve())
            .addOnFailureListener(ignored -> call.reject("Could not clear the saved Google authorization."));
    }
}
