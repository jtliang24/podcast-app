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
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.Scopes;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.common.api.UnsupportedApiCallException;
import java.util.Collections;
import java.util.List;

@CapacitorPlugin(name = "PodcastDrive")
public class PodcastDrivePlugin extends Plugin {
    @PluginMethod
    public void authorize(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            MainActivity activity = (MainActivity) getActivity();
            GoogleApiAvailability availability = GoogleApiAvailability.getInstance();
            int status = availability.isGooglePlayServicesAvailable(activity);
            if (status != ConnectionResult.SUCCESS) {
                call.reject("Google Play services is unavailable (" + availability.getErrorString(status)
                    + ", code " + status + "). Check that Play Store is enabled and up to date.");
                return;
            }
            boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive"));
            requestAuthorization(activity, Identity.getAuthorizationClient(activity), call, interactive, interactive);
        });
    }

    private static void requestAuthorization(MainActivity activity, AuthorizationClient client, PluginCall call,
                                             boolean interactive, boolean selectAccount) {
        AuthorizationRequest.Builder request = AuthorizationRequest.builder()
            .setRequestedScopes(Collections.singletonList(new Scope(Scopes.DRIVE_APPFOLDER)));
        if (selectAccount) request.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT);
        client.authorize(request.build()).addOnSuccessListener(activity, result -> {
            if (!result.hasResolution()) {
                resolveToken(call, result);
            } else if (!interactive) {
                call.resolve();
            } else if (result.getPendingIntent() == null) {
                call.reject("Google Play services did not provide a Google account chooser.");
            } else if (!activity.authorizeDrive(result.getPendingIntent(), response -> {
                if (response.getResultCode() == Activity.RESULT_CANCELED && response.getData() == null) {
                    call.resolve();
                    return;
                }
                try {
                    resolveToken(call, client.getAuthorizationResultFromIntent(response.getData()));
                } catch (ApiException error) {
                    if (error.getStatusCode() == CommonStatusCodes.CANCELED) call.resolve();
                    else rejectAuthorization(call, error);
                }
            })) {
                call.reject("Could not open the Google account chooser. Close any open chooser and try again.");
            }
        }).addOnFailureListener(activity, error -> {
            if (selectAccount && error instanceof UnsupportedApiCallException) {
                requestAuthorization(activity, client, call, interactive, false);
            } else {
                rejectAuthorization(call, error);
            }
        });
    }

    private static void rejectAuthorization(PluginCall call, Exception error) {
        if (error instanceof ApiException apiError) {
            int status = apiError.getStatusCode();
            String guidance = switch (status) {
                case CommonStatusCodes.DEVELOPER_ERROR -> "Check the Android OAuth client's package name and APK certificate SHA-1 in Google Cloud.";
                case CommonStatusCodes.SIGN_IN_REQUIRED, CommonStatusCodes.INVALID_ACCOUNT -> "Check which Google accounts are signed in on the device.";
                case CommonStatusCodes.NETWORK_ERROR -> "Check the device's internet connection and try again.";
                default -> "Check that Play Store is up to date and the account can access this app.";
            };
            call.reject("Google Drive authorization failed (" + CommonStatusCodes.getStatusCodeString(status)
                + ", code " + status + "). " + guidance);
        } else if (error instanceof UnsupportedApiCallException) {
            call.reject("The installed Google Play services does not support Drive authorization. Check for a Play services update.");
        } else {
            call.reject("Google Play services could not start Drive authorization.");
        }
    }

    private static void resolveToken(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        List<String> grantedScopes = result.getGrantedScopes();
        if (token == null || token.isEmpty()) {
            call.reject("Google did not return a Drive access token. Try connecting again.");
        } else if (grantedScopes == null || !grantedScopes.contains(Scopes.DRIVE_APPFOLDER)) {
            call.reject("Google did not grant the app-data permission. Try again and allow access to Podcast Player's Drive data.");
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
