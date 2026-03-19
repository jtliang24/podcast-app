# Podcast Player Project Overview

A portable, local-first podcast listening application built with **React**, **TypeScript**, and **Vite**. The app is designed for performance and portability, storing all user data (subscriptions, playback progress, and display preferences) in a single, user-selected JSON file via the **File System Access API** (Desktop) or **Origin Private File System** (Mobile).

## Core Technologies
- **Frontend:** React 19, TypeScript, Tailwind CSS
- **Build Tool:** Vite 6
- **Data Persistence (Synced):** File System Access API (Desktop) and Origin Private File System (OPFS, Mobile)
- **Data Persistence (Local/Offline):** **IndexedDB** (for storing episode metadata, audio blobs, and file handles)
- **Data Parsing:** `fast-xml-parser` (for RSS feeds and OPML files)
- **Podcast Discovery:** iTunes Search API
- **Icons:** Lucide React
- **Environment:** Nix (via `shell.nix`)

## Architecture
The application follows a "local-first" architecture with a hybrid storage model:
1.  **State Management (Synced):** App state (subscriptions, playback progress, played status, and per-podcast sort/filter settings) is managed in a local JSON file (Desktop) or internally in the browser's OPFS (Mobile). Data portability is ensured via manual **Import/Export** of the state JSON.
2.  **Download Management (Device-Specific):** Audio files and their associated metadata are stored in **IndexedDB**. This ensures downloads are persistent across sessions but remain specific to the local device.
3.  **File Handle Persistence:** On Desktop, the application stores the `FileSystemFileHandle` in IndexedDB. On startup, it automatically attempts to restore access to the previous state file, prompting only for permissions if needed.
4.  **Service Layer:** 
    - `src/services/podcastService.ts`: Handles RSS/OPML parsing and iTunes search logic. Uses CORS proxies for browser compatibility.
    - `src/services/storageService.ts`: Manages the IndexedDB lifecycle for offline episode storage.
5.  **Hooks:** 
    - `src/hooks/useFileSystem.ts`: Abstracts platform-specific storage logic and file handle persistence.
    - `src/hooks/usePodcastPlayer.ts`: Manages audio playback state, queue logic, and progress tracking.
6.  **Playback Logic:** 
    - Automatically checks for offline audio in IndexedDB before streaming from the web.
    - Initiates background downloads when playing a remote episode.
    - Automatically marks episodes as "played" upon completion.
    - Periodically auto-saves playback position to the local state file (throttled to once every 10 seconds for performance).

## Features
- **New Releases**: A dedicated view aggregating the latest episodes from all subscriptions. Uses batched fetching (10 at a time) and progressive UI updates for high performance. Cached data is persisted in the state file for instant loading.
- **Advanced Sorting**: Per-podcast sorting options (Newest, Oldest, A-Z, Z-a, Duration) persisted in the state file.
- **Played Tracking**: Global tracking of played episodes with manual toggles, automatic marking, and "Hide Played" filtering.
- **Bulk Actions**: "Mark Older as Played" to quickly manage podcast backlogs.

## Project Structure
- `src/components/`: Modular UI components (Sidebar, Header, PodcastPlayer, View-specific components).
- `src/hooks/useFileSystem.ts`: Synced JSON state and file handle persistence.
- `src/hooks/usePodcastPlayer.ts`: Encapsulated playback and queue logic.
- `src/services/podcastService.ts`: RSS/OPML parsing and search.
- `src/services/storageService.ts`: IndexedDB wrapper for downloads.
- `src/types.ts`: TypeScript interfaces for Podcasts, Episodes, and App State.
- `src/App.tsx`: Main application entry point and layout orchestrator.

## Building and Running

### Development Environment
The project uses **Nix** for a consistent development environment.
1.  Enter the shell:
    ```bash
    nix-shell
    ```
    *(This will automatically install npm dependencies if they are missing)*.

### Available Scripts
- `npm run dev`: Starts the Vite development server.
- `npm run build`: Compiles the project using `tsc` and Vite for production.
- `npm run lint`: Runs ESLint for code quality checks.
- **`npm run start-app`**: Builds the app and launches it in a standalone window (App Mode).

## Development Conventions
- **Type Safety:** Strict TypeScript is enforced.
- **Import Style:** Use `import type` for type-only imports.
- **Styling:** Use Tailwind CSS utility classes.
- **Persistence:** Metadata and user preferences must sync with the local JSON file; binary audio and file handles stay in IndexedDB.
- **Performance:** 
    - Avoid high-frequency disk writes; throttle state persistence.
    - Use pooled/batched requests for multi-feed operations.
    - Prioritize progressive UI updates for long-running fetch tasks.
- **CORS:** All RSS fetches must go through a CORS proxy to work in the browser.

## Future Plans (Strategic Roadmap)
All current and future development must align with these strategic goals.

### 1. Cloud API Integration (Automated Sync)
- **Goal:** Replace manual file-picking with direct integration for **Google Drive** and **Dropbox**.
- **Requirement:** Implement OAuth2 flows and cloud-aware persistence logic in `useFileSystem.ts`.

### 2. Native Mobile Application (Capacitor)
- **Goal:** Package the web app as a native Android/iOS app.
- **Requirement:** Integrate Capacitor for native filesystem access and background audio support.

### 3. Native File System Access for Mobile
- **Goal:** Use Android's Storage Access Framework (SAF) via Capacitor to allow the mobile app to "live-link" to a local JSON file.
- **Requirement:** Create a bridge between the browser's `useFileSystem` and native Android storage APIs.
