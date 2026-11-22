---
name: podcast-android-debug
description: Build and verify a local Android debug APK for the Podcast App repository. Use for phone testing, debug APK upgrades, or checking the debug signing certificate for Google Drive OAuth. GitHub release builds use the podcast-android-release skill.
---

# Podcast App Android debug build

## Check the local signing key

Use the Podcast App checkout and the Android toolchain described in [Build a debug APK](../../../README.md#build-a-debug-apk). Reuse the configured SDK and JDK. Make the SDK's `apksigner` and the JDK's `java` available on `PATH`. Run `npm ci` if the checkout needs its dependencies installed.

Run `(cd android && ./gradlew :app:signingReport)` and check `Store` and `SHA1` under `Variant: debug`. The default keystore is `~/.android/debug.keystore`. Use the same Android user directory if the workstation sets `ANDROID_USER_HOME`.

Compare the reported SHA-1 with the previous local debug APK or the registered Android debug OAuth client when available. Capture the previous APK's SHA-1 before rebuilding because Gradle replaces the output at the same path. If the established keystore is missing or the fingerprint differs, resolve the key location or recover the original keystore before producing an update. On a first-time setup, let Gradle create the debug key once, then record its fingerprint and keep a private backup of the keystore outside Git.

## Build and verify

Run these commands from the repository root. Proceed after each succeeds.

```bash
npm run build -- --mode android
npx cap sync android
(cd android && ./gradlew assembleDebug)
apksigner verify --print-certs android/app/build/outputs/apk/debug/app-debug.apk
```

Confirm signature verification succeeds and the APK's `Signer #1 certificate SHA-1 digest` matches the expected debug SHA-1. Gradle and `apksigner` format the same fingerprint differently, so compare the hex digits case-insensitively and ignore colons. On a first build, compare the APK with the signing report after Gradle creates the key.

Report the APK path, the verified SHA-1, and any device checks performed. When installation is requested, use `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` for an in-place update with the matching package and signing key. If the device reports a signing mismatch or version downgrade, report it and preserve the installed app and data.

## Google Drive authorization

Use the verified debug certificate SHA-1 with package `io.github.jtliang24.podcastapp` in a separate Android OAuth client in the same Google Cloud project as the browser client. Reuse that client for subsequent builds signed by this key. If authorization fails, check the package, APK fingerprint, and test-user access against the [repository's Drive setup](../../../README.md#configure-release-signing-and-google-drive).
