package io.github.jtliang24.podcastapp;

import android.util.AtomicFile;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

final class PrivateFiles {
    private PrivateFiles() {}

    static void write(AtomicFile file, String json) throws IOException {
        FileOutputStream output = file.startWrite();
        try {
            output.write(json.getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (IOException exception) {
            file.failWrite(output);
            throw exception;
        }
    }

    static String read(AtomicFile file) throws IOException {
        return new String(file.readFully(), StandardCharsets.UTF_8);
    }
}
