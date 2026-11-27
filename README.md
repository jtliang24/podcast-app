# 🎙️ Portable Podcast Player

A modern, local-first podcast listening application designed for privacy, portability, and performance. Built with React, TypeScript, and Tailwind CSS.

## ✨ Features

- **🚀 Local-First Architecture**: Local profiles use a JSON file. Drive profiles cache subscriptions, preferences, and listening progress in IndexedDB.
- **☁️ Cloud Sync**: Drive keeps the original profile as a starting snapshot and syncs subsequent edits through its private app-data folder. Pending edits survive offline use and reconnecting to the same account.
- **📥 Offline Listening**: Download episodes directly to your browser's IndexedDB for playback without an internet connection.
- **🔄 Session Continuity**: Pause on one device and choose **Continue listening** on another to resume at the saved position. A visible, paused receiver checks for updates every 15 seconds on Wi-Fi or Ethernet. On cellular or when the connection type is unknown, reopen the app, return to it, or use **Refresh sync**. Update all devices that share the library before using handoff.
- **📱 PWA Support**: Installable on Desktop and Mobile for a native-like experience.
- **🎵 System Integration**: Full support for the Media Session API, allowing control via lock screens, hardware buttons, and system media widgets.
- **📑 OPML Support**: Easily import or export your podcast subscriptions using standard OPML files.
- **🕒 Smart Queue**: Manage your listening order with a persistent, reorderable queue that stays in sync across sessions.
- **⏩ Playback Speed**: Set a global speed and an optional per-podcast override (0.5× to 3×). Speed preferences sync through Drive with the rest of your profile.
- **😴 Sleep Timer**: Stop after a set time, at the end of the episode, or at the end of the chapter. The volume fades out, then playback pauses. The timer is local to the device and never syncs. On Android it runs in the playback service, so it keeps working while the screen is locked.
- **📚 Chapters**: Reads Podcasting 2.0 JSON chapters and Podlove Simple Chapters. Browse the chapter list, see chapter ticks on the timeline and chapter art, and jump to the previous or next chapter.
- **📝 Transcripts**: Reads VTT, SRT, JSON, HTML, and plain-text transcripts. The current line is highlighted and scrolled into view, and you can search the text.
- **🗃️ Episode Extras**: Chapter and transcript files are cached per device in the IndexedDB database `podcast_episode_extras`, never in the synced profile. Files for downloaded episodes are pinned for offline use. Private Substack feeds never fetch these files through public proxies.

## 🛠️ Technology Stack

- **Frontend**: React 19, TypeScript, Vite 6
- **Styling**: Tailwind CSS
- **Persistence**: File System Access API, Origin Private File System (OPFS), IndexedDB, Google Drive API
- **Icons**: Lucide React
- **Audio**: HTML5 Audio + Media Session API

## 🚀 Getting Started

### Prerequisites

- Node.js (Latest LTS recommended)
- [Nix](https://nixos.org/) with Flakes enabled (Optional, for a reproducible development environment)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/podcast-player.git
   cd podcast-player
   ```

2. (Optional) If using Nix, enter the development environment:
   ```bash
   nix develop
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Set up environment variables:
   Copy `.env.example` to `.env` and add your Google Drive API credentials if you want to enable Cloud Sync.

### Development

The app tries podcast feeds directly, then uses a CORS proxy if needed. Set
`VITE_CORSPROXY_KEY` in `.env` to enable CorsProxy before the public AllOrigins
fallback. Use a browser key restricted to your app's domains.

For a private Substack podcast, paste the RSS link from **Manage subscription →
Private podcast feed → Set up podcast**. If the browser cannot read the feed
directly, `npm run dev`, `npm run preview`, and `npm run start-app` can fetch
it through the app's own server. Private Substack feeds skip public proxies.
Serving only the static `dist/` files requires a separate implementation of
`POST /api/substack-feed` for this fallback.

Run the development server with HTTPS enabled:
```bash
npm run dev
```

### Building

Build the project for production:
```bash
npm run build
```

## Android APK

The app supports Android 6.0 (API 23) and later with an up-to-date Android
System WebView or Chrome. Google Drive sync requires Google Play services.

### Build a debug APK

Install Node.js 20 or newer, JDK 21, Android SDK Platform 35, and Android SDK
Build-Tools 34.0.0 and 35.0.0. Set `JAVA_HOME` to the JDK path. Set
`ANDROID_HOME`, or set `sdk.dir` in `android/local.properties`, to the SDK path.
Capacitor Core, CLI, and Android are pinned to 7.4.4. The project includes the
Gradle 8.11.1 wrapper.
[Capacitor 7 Android setup](https://capacitorjs.com/docs/v7/getting-started/environment-setup)

Run these commands from the repository root.

```bash
npm ci
npm test
npm run lint
npm run build
npm run build -- --mode android
npx cap sync android
cd android
./gradlew assembleDebug
```

The Android-mode build bundles the site in the APK, disables the service worker,
and omits browser OAuth and CORS proxy settings. The debug APK is
`android/app/build/outputs/apk/debug/app-debug.apk`. Use
`adb install -r android/app/build/outputs/apk/debug/app-debug.apk` from the
repository root to install it on a connected device.

### Move a library to Android

- **JSON**. In the browser, open **Settings → Data Portability** and choose
  **Export JSON**. Copy the file to the phone. In the Android app, open
  **Settings → Data Portability** and choose **Import JSON** to load a copy into
  app-private storage or **Open and link JSON file** to keep writing to that
  document. **Create linked JSON file** writes the current library to a new
  document. If access is revoked, **Reconnect JSON file** writes the retained
  library to the writable document you select.
- **Google Drive**. Push pending changes from the browser, then choose
  **Connect Google Drive** in the Android app and authorize the same account.
  The APK must have a registered signing certificate to use Drive.
- Download audio again in the Android app. Browser downloads are stored in the
  browser and the APK keeps its own downloads. Android fetches RSS and streams
  audio over HTTPS. Private Substack RSS links go directly to Substack.
- Android saves playback checkpoints while the screen is locked and applies
  them to your library when you reopen the app.

### Configure release signing and Google Drive

Create a release key once. Keep its keystore and passwords outside Git. Store
an encrypted backup of the keystore in a separate location and back up the
password in your password manager. The application ID
`io.github.jtliang24.podcastapp` and signing key must stay the same for updates.
[Android app signing](https://developer.android.com/studio/publish/app-signing)

```bash
keytool -genkeypair -keystore /secure/path/podcast-player.p12 -storetype PKCS12 \
  -alias podcast-player -keyalg RSA -keysize 4096 -validity 10000
```

Create a private `keystore.properties` file outside the repository and set
`PODCAST_SIGNING_PROPERTIES` to that file's absolute path. Set `storeFile`
to the absolute keystore path or a path relative to the properties file. Set
`storePassword`, `keyAlias`, and `keyPassword` to the values for that key.

In the same Google Cloud project as the browser OAuth client, enable the Drive
API and configure the consent screen for
`https://www.googleapis.com/auth/drive.appdata`. Create an Android OAuth client
for `io.github.jtliang24.podcastapp` for each signing certificate's SHA-1
fingerprint. Use `./gradlew signingReport` in `android/` for debug and
`apksigner verify --print-certs` on the signed APK for release. Add the
appropriate users to the consent screen's test list while it is in testing.
[Google authorization on Android](https://developers.google.com/identity/authorization/android)

### Build, verify, and publish a release

Set `versionName` in `android/app/build.gradle` to the release version and
increment `versionCode` for each published APK. Build and sync with the steps
above, then build and verify the APK from `android/` with signing configured.

```bash
./gradlew assembleRelease
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose --print-certs \
  app/build/outputs/apk/release/app-release.apk
```

Verify the release-signed APK on a physical phone before publishing.

1. Install the APK and launch it offline. Go online and test iTunes search,
   public RSS, a private Substack feed, and streaming.
2. Download two queued episodes and go offline. Start playback, lock the
   screen, and check play, pause, seeking, and automatic queue advance. Reopen
   the app and confirm that the current episode and playback position are saved.
3. Open or create a linked JSON file. Make an edit, restart, and verify the same
   document receives later updates. Remove the provider's access or move the
   document through the provider to break its grant, verify the library stays
   available, then reconnect. Test JSON export and import.
4. Sync with Drive using the release signing identity. Verify the library and
   progress in both directions and reconnect after revoking Google access.
5. Download and install the staged release asset using the phone's package
   installer. Install a higher-version APK signed by the same release key over
   it. Confirm subscriptions, progress, document access, and downloads survive.

Name the APK `podcast-player-<version>.apk`. From its directory, run
`sha256sum podcast-player-<version>.apk > podcast-player-<version>.apk.sha256`.
Attach both files to the corresponding version tag's repository release and
include the Android 6.0 minimum and the installation steps below.

On your phone, download the APK from the repository's release page and open it
with Android's package installer. If prompted, enable **Allow from this
source** for the browser or file manager you used. A private repository
requires repository access to download its release assets.

### Build an Android release on GitHub

The [Android release workflow](.github/workflows/android-release.yml) runs on
version tags such as `v0.1.0`. It tests, builds, signs, and verifies the APK,
then attaches the APK and its SHA-256 checksum to a draft GitHub release.

Add these repository secrets under **Settings → Secrets and variables →
Actions**, or set them with the GitHub CLI from the repository root.

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of the existing release keystore used to sign updates |
| `ANDROID_SIGNING_PROPERTIES` | Three lines in Java properties format for `storePassword`, `keyAlias`, and `keyPassword` |

Omit `storeFile` from the secret. The workflow sets it to the decoded keystore
on the GitHub runner. The command below copies only the three signing entries
from a local file that uses one `key=value` entry per line.

```bash
base64 < /secure/path/podcast-player.p12 | gh secret set ANDROID_KEYSTORE_BASE64
sed -nE '/^[[:blank:]]*(storePassword|keyAlias|keyPassword)[[:blank:]]*=/p' \
  /secure/path/keystore.properties | gh secret set ANDROID_SIGNING_PROPERTIES
```

Make sure the version in `package.json` and Android's `versionName` both match
the tag without the `v`. Increase Android's `versionCode` for each subsequent
release. Commit and push the workflow and version changes before tagging that
commit. For the first release, push the version tag with these commands.

```bash
git tag -a v0.1.0 -m "Podcast Player v0.1.0"
git push origin v0.1.0
```

After the workflow succeeds, download the APK from the draft and run the
physical-device checks above. Review the release notes and publish from
GitHub. Rerunning the workflow refreshes the assets while the release is a
draft.

## 📜 License

This project is licensed under the MIT License.
