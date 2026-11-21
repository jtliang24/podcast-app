package io.github.jtliang24.podcastapp;

import android.os.SystemClock;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

final class NativeRequests {
    private NativeRequests() {}

    static URI httpsUri(String value) {
        URI uri = URI.create(value);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null) {
            throw new IllegalArgumentException("Expected an HTTPS URL");
        }
        return uri;
    }

    private static boolean privateFeedHost(URI uri) {
        String host = uri.getHost().toLowerCase(Locale.ROOT).replaceFirst("\\.$", "");
        return uri.getPort() == -1 && (host.equals("substack.com") || host.endsWith(".substack.com"));
    }

    static HttpURLConnection open(String url, boolean privateFeed, String accept, long deadline) throws IOException {
        URI target = httpsUri(url);
        if (privateFeed && !target.getRawPath().startsWith("/feed/podcast/")) {
            throw new IOException("Invalid private feed");
        }
        for (int redirects = 0; redirects <= 5; redirects++) {
            if (privateFeed && !privateFeedHost(target)) throw new IOException("Invalid private feed host");

            HttpURLConnection connection = (HttpURLConnection) target.toURL().openConnection();
            int timeout = (int) Math.max(1, Math.min(30_000, deadline - SystemClock.elapsedRealtime()));
            connection.setConnectTimeout(timeout);
            connection.setReadTimeout(timeout);
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", accept);
            boolean keepOpen = false;
            try {
                if (SystemClock.elapsedRealtime() >= deadline) throw new IOException("Request timed out");
                int status = connection.getResponseCode();
                if (status != 301 && status != 302 && status != 303 && status != 307 && status != 308) {
                    keepOpen = true;
                    return connection;
                }
                String location = connection.getHeaderField("Location");
                if (location == null) break;
                target = httpsUri(target.resolve(location).toString());
            } finally {
                if (!keepOpen) connection.disconnect();
            }
        }
        throw new IOException("Too many redirects");
    }

    static String readText(InputStream input, int limit, long deadline) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        for (int count; (count = input.read(buffer)) != -1;) {
            if (count > limit - bytes.size()) throw new IOException("File exceeds size limit");
            if (SystemClock.elapsedRealtime() >= deadline) throw new IOException("Read timed out");
            bytes.write(buffer, 0, count);
        }
        return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
    }
}
