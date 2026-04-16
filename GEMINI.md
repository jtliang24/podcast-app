# Podcast Player Project Overview

A portable, local-first podcast listening application built with **React**, **TypeScript**, and **Vite**. The app is designed for performance and portability, storing all user data (subscriptions, playback progress, and display preferences) in a single, user-selected JSON file via the **File System Access API** (Desktop), **Origin Private File System** (Mobile), or **Google Drive** (Cloud Sync).

## Core Technologies
- **Frontend:** React 19, TypeScript, Tailwind CSS
- **Build Tool:** Vite 6
- **Local Development:** `vite-plugin-mkcert` (Local HTTPS for PWA testing)
- **Data Persistence (Synced):** File System Access API (Desktop), Origin Private File System (OPFS, Mobile), and Google Drive API (Cloud Sync)
- **Data Persistence (Local/Offline):** **IndexedDB** (for storing episode metadata, audio blobs, and file handles)
- **APIs:** Media Session API (System audio controls), iTunes Search API, Google Drive API
- **Data Parsing:** `fast-xml-parser` (for RSS feeds and OPML files)
- **Icons:** Lucide React
- **Environment:** Nix (via `shell.nix`)

## Architecture
The application follows a "local-first" architecture with a hybrid storage model:
1.  **State Management (Synced):** App state (subscriptions, playback progress, played status, per-podcast sort/filter settings, and the last playing episode) is managed in a local JSON file (Desktop), internally in the browser's OPFS (Mobile), or synced via Google Drive. Data portability is ensured via manual **Import/Export** or automated Cloud Sync.
2.  **Download Management (Device-Specific):** Audio files and their associated metadata are stored in **IndexedDB**. This ensures downloads are persistent across sessions but remain specific to the local device.
3.  **Session Restoration:** On startup, the application automatically restores the state from the synced JSON file. It identifies the last played episode and pre-loads it into the player, restoring the exact playback position and metadata even across complete application restarts.
4.  **File Handle Persistence:** On Desktop, the application stores the `FileSystemFileHandle` in IndexedDB. On startup, it automatically attempts to restore access to the previous state file, prompting only for permissions if needed.
5.  **Service Layer:** 
    - `src/services/podcastService.ts`: Handles RSS/OPML parsing and iTunes search logic. Uses CORS proxies for browser compatibility.
    - `src/services/storageService.ts`: Manages the IndexedDB lifecycle for offline episode storage.
    - `src/services/driveService.ts`: Handles Google Drive API interactions for cloud synchronization.
6.  **Hooks:** 
    - `src/hooks/useFileSystem.ts`: Abstracts platform-specific storage logic, file handle persistence, and cloud sync.
    - `src/hooks/usePodcastPlayer.ts`: Manages audio playback state, queue logic, progress tracking, session restoration, and **Media Session API** integration for system-level controls.
7.  **Playback Logic:** 
    - Automatically checks for offline audio in IndexedDB before streaming from the web.
    - Initiates background downloads when playing a remote episode.
    - Automatically marks episodes as "played" upon completion.
    - Periodically auto-saves playback position and current episode to the local/cloud state file (throttled for performance).
    - Integrates with system media controls for play/pause, seeking, and metadata display.

## Features
- **Progressive Web App (PWA)**: Installable as a standalone application with service worker support.
- **Persistent Player Bar**: A permanent playback control bar at the bottom of the screen provides constant access to playback status, seek controls, and the play queue, regardless of whether an episode is currently active.
- **Session Continuity**: Automatically remembers and pre-loads the last playing episode and its exact timestamp when the app is reopened.
- **Smart Queue Management**: Manages playback order, ensuring the currently playing episode remains securely at the top of the queue. Allows direct playback from any item in the queue.
- **Cloud Sync (Google Drive)**: Secure synchronization of app state across devices using Google Drive's hidden `appDataFolder`.
- **System Media Controls**: Full integration with the browser's Media Session API, allowing control via OS-level media widgets, lock screens, and hardware buttons. Includes rich metadata and high-quality artwork.
- **New Releases**: A dedicated view aggregating the latest episodes from all subscriptions. Uses batched fetching (10 at a time) and progressive UI updates for high performance.
- **Advanced Sorting**: Per-podcast sorting options (Newest, Oldest, A-Z, Z-a, Duration) persisted in the state file.
- **Played Tracking**: Global tracking of played episodes with manual toggles, automatic marking, and "Hide Played" filtering.
- **Episode Details**: Dedicated view for reading full episode descriptions and metadata (including keywords).

## Project Structure
- `src/components/`: Modular UI components (Sidebar, Header, PodcastPlayer, View-specific components like `EpisodeDescriptionView`).
- `src/hooks/useFileSystem.ts`: Synced JSON state, file handle persistence, and cloud sync logic.
- `src/hooks/usePodcastPlayer.ts`: Encapsulated playback, queue, and Media Session logic.
- `src/services/podcastService.ts`: RSS/OPML parsing and search.
- `src/services/storageService.ts`: IndexedDB wrapper for downloads.
- `src/services/driveService.ts`: Google Drive synchronization service.
- `src/types.ts`: TypeScript interfaces for Podcasts, Episodes, and App State.

## Building and Running

### Development Environment
The project uses **Nix** for a consistent development environment.
1.  Enter the shell:
    ```bash
    nix-shell
    ```
2.  Create a `.env` file based on `.env.example` and add your API keys.

### Available Scripts
- `npm run dev`: Starts the Vite development server with HTTPS and network access enabled (`--host`).
- `npm run build`: Compiles the project using `tsc` and Vite for production.
- `npm run lint`: Runs ESLint for code quality checks.
- **`npm run start-app`**: Builds the app and launches it in a standalone window (App Mode).

## Development Conventions
- **Type Safety:** Strict TypeScript is enforced.
- **Local HTTPS:** Enabled by default to support PWA features and the File System Access API across the local network.
- **Security:** Never commit API keys or secrets. Use `.env` files and refer to `.env.example`.
- **Import Style:** Use `import type` for type-only imports.
- **Styling:** Use Tailwind CSS utility classes.
- **Persistence:** Metadata and user preferences must sync with the state file (local or cloud); binary audio stays in IndexedDB.
- **Performance:** 
    - Avoid high-frequency disk/network writes; throttle state persistence.
    - Use pooled/batched requests for multi-feed operations.
    - Prioritize progressive UI updates for long-running fetch tasks.

## Future Plans (Strategic Roadmap)
All current and future development must align with these strategic goals.

### 1. Native Mobile Application (Capacitor)
- **Goal:** Package the web app as a native Android/iOS app.
- **Requirement:** Integrate Capacitor for native filesystem access and background audio support.

### 2. Native File System Access for Mobile
- **Goal:** Use Android's Storage Access Framework (SAF) via Capacitor to allow the mobile app to "live-link" to a local JSON file.
- **Requirement:** Create a bridge between the browser's `useFileSystem` and native Android storage APIs.
