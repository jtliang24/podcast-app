package io.github.jtliang24.podcastapp;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.net.Uri;
import android.util.AtomicFile;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "PodcastFiles")
public class PodcastFilesPlugin extends Plugin {
    private static final int READ_WRITE = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    private static final int STATE_LIMIT = 32 * 1024 * 1024;
    private static final ExecutorService FILES = Executors.newSingleThreadExecutor();
    private AtomicFile storage;
    private volatile boolean choosingDocument;

    @Override
    public void load() {
        storage = new AtomicFile(new File(getContext().getFilesDir(), "library.json"));
    }

    @PluginMethod
    public void readState(PluginCall call) {
        FILES.execute(() -> readLibrary(call));
    }

    private void readLibrary(PluginCall call) {
        try {
            JSONObject record = loadRecord();
            Uri uri = linkedUri(record);
            boolean reconnect = record.optBoolean("pending");
            if (uri != null && !reconnect) {
                try {
                    requirePermission(uri);
                    String json = readDocument(uri);
                    validateState(json);
                    record.put("json", json);
                    saveRecord(record);
                } catch (Exception ignored) {
                    reconnect = true;
                    record.put("pending", true);
                    saveRecord(record);
                }
            }
            call.resolve(result(record, reconnect));
        } catch (Exception ignored) {
            call.reject("Could not open the local library.");
        }
    }

    @PluginMethod
    public void writeState(PluginCall call) {
        FILES.execute(() -> writeLibrary(call));
    }

    private void writeLibrary(PluginCall call) {
        try {
            JSONObject record = loadRecord();
            if (!record.optString("id", "local").equals(call.getString("id"))) {
                call.reject("The local library has changed.");
                return;
            }
            String json = call.getString("json");
            Uri uri = linkedUri(record);
            boolean wasPending = record.optBoolean("pending");
            record.put("json", json).put("pending", uri != null);
            saveRecord(record);
            if (uri != null && !wasPending) {
                try {
                    requirePermission(uri);
                    writeDocument(uri, json);
                    record.put("pending", false);
                    saveRecord(record);
                } catch (Exception ignored) {
                    // The app-private copy has already been saved.
                    record.put("pending", true);
                }
            }
            call.resolve(new JSObject().put("reconnect", record.optBoolean("pending")));
        } catch (Exception ignored) {
            call.reject("Could not save the local library.");
        }
    }

    @PluginMethod
    public void linkState(PluginCall call) {
        String action = call.getString("action");
        boolean create = "create".equals(action);
        Intent picker = documentPicker(create, "podcast_state.json", "application/json");
        picker.addFlags(READ_WRITE | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        launchPicker(call, picker, "linkResult");
    }

    @PluginMethod
    public void exportFile(PluginCall call) {
        Intent picker = documentPicker(true, call.getString("name"), call.getString("mimeType"));
        picker.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        launchPicker(call, picker, "exportResult");
    }

    private Intent documentPicker(boolean create, String name, String mimeType) {
        Intent intent = new Intent(create ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(create ? mimeType : "*/*");
        if (create) intent.putExtra(Intent.EXTRA_TITLE, name);
        return intent;
    }

    private void launchPicker(PluginCall call, Intent picker, String callback) {
        if (choosingDocument) {
            call.reject("A document picker is already open.");
            return;
        }
        choosingDocument = true;
        try {
            startActivityForResult(call, picker, callback);
        } catch (Exception ignored) {
            choosingDocument = false;
            call.reject("Could not open the Android document picker.");
        }
    }

    @ActivityCallback
    private void linkResult(PluginCall call, ActivityResult response) {
        FILES.execute(() -> {
            choosingDocument = false;
            if (call == null) return;
            Uri uri = pickedUri(response);
            if (uri == null) {
                call.resolve(new JSObject().put("cancelled", true));
                return;
            }
            Uri previous = null;
            boolean linked = false;
            try {
                JSONObject record = loadRecord();
                previous = linkedUri(record);
                int flags = response.getData().getFlags() & READ_WRITE;
                if (flags != READ_WRITE) throw new IOException("Writable document required");
                resolver().takePersistableUriPermission(uri, flags);
                requirePermission(uri);
                String json;
                if ("open".equals(call.getString("action"))) {
                    json = readDocument(uri);
                    validateState(json);
                    if (!uri.equals(previous)) record.put("id", UUID.randomUUID().toString());
                } else {
                    json = record.optString("json", "{}");
                    writeDocument(uri, json);
                }
                record.put("json", json).put("uri", uri.toString()).put("pending", false);
                saveRecord(record);
                linked = true;
                if (previous != null && !previous.equals(uri)) release(previous);
                call.resolve(result(record, false));
            } catch (Exception ignored) {
                call.reject("Could not link a writable JSON document.");
            } finally {
                if (!linked && !uri.equals(previous)) release(uri);
            }
        });
    }

    @ActivityCallback
    private void exportResult(PluginCall call, ActivityResult response) {
        FILES.execute(() -> {
            choosingDocument = false;
            if (call == null) return;
            Uri uri = pickedUri(response);
            try {
                if (uri != null) writeDocument(uri, call.getString("content"));
                call.resolve();
            } catch (Exception ignored) {
                call.reject("Could not write the exported file.");
            }
        });
    }

    private static Uri pickedUri(ActivityResult response) {
        Intent data = response.getData();
        return response.getResultCode() == Activity.RESULT_OK && data != null ? data.getData() : null;
    }

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    private void requirePermission(Uri uri) throws IOException {
        for (UriPermission permission : resolver().getPersistedUriPermissions()) {
            if (uri.equals(permission.getUri()) && permission.isReadPermission() && permission.isWritePermission()) return;
        }
        throw new IOException("Document access was revoked");
    }

    private void release(Uri uri) {
        try {
            resolver().releasePersistableUriPermission(uri, READ_WRITE);
        } catch (SecurityException ignored) {
            // The grant can already have been revoked by the provider.
        }
    }

    private String readDocument(Uri uri) throws IOException {
        try (InputStream input = resolver().openInputStream(uri)) {
            if (input == null) throw new IOException("Document unavailable");
            return NativeRequests.readText(input, STATE_LIMIT, Long.MAX_VALUE);
        }
    }

    private void writeDocument(Uri uri, String content) throws IOException {
        // rwt truncates older, longer versions of the document.
        try (OutputStream output = resolver().openOutputStream(uri, "rwt")) {
            if (output == null) throw new IOException("Document unavailable");
            output.write(content.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static void validateState(String json) throws Exception {
        JSONObject state = new JSONObject(json);
        for (String key : new String[] {"subscriptions", "queue", "newReleases"}) {
            if (!state.has(key)) continue;
            JSONArray list = state.getJSONArray(key);
            for (int i = 0; i < list.length(); i++) {
                JSONObject item = list.getJSONObject(i);
                item.getString("id");
                item.getString("title");
                item.getString(key.equals("subscriptions") ? "feedUrl" : "audioUrl");
            }
        }
        for (String key : new String[] {"playbackProgress", "podcastSortOrders", "playedEpisodes", "hidePlayedEpisodes"}) {
            if (state.has(key)) state.getJSONObject(key);
        }
        if (state.has("lastPlayingEpisode") && !state.isNull("lastPlayingEpisode")) {
            state.getJSONObject("lastPlayingEpisode").getString("audioUrl");
        }
    }

    private JSONObject loadRecord() throws Exception {
        try {
            return new JSONObject(PrivateFiles.read(storage));
        } catch (FileNotFoundException ignored) {
            return new JSONObject();
        }
    }

    private void saveRecord(JSONObject record) throws IOException {
        PrivateFiles.write(storage, record.toString());
    }

    private static Uri linkedUri(JSONObject record) {
        return record.has("uri") ? Uri.parse(record.optString("uri")) : null;
    }

    private static JSObject result(JSONObject record, boolean reconnect) {
        return new JSObject().put("id", record.optString("id", "local")).put("json", record.opt("json") == null
            ? JSONObject.NULL : record.optString("json")).put("linked", linkedUri(record) != null).put("reconnect", reconnect);
    }

}
