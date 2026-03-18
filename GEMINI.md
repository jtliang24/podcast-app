# Podcast Player Project Overview

A portable, local-first podcast listening application built with **React**, **TypeScript**, and **Vite**. The app is designed for performance and portability, storing all user data (subscriptions and playback progress) in a single, user-selected JSON file via the **File System Access API** (Desktop) or **Origin Private File System** (Mobile).

## Core Technologies
- **Frontend:** React 19, TypeScript, Tailwind CSS
- **Build Tool:** Vite 6
- **Data Persistence (Synced):** File System Access API (Desktop) and Origin Private File System (OPFS, Mobile)
- **Data Persistence (Local/Offline):** **IndexedDB** (for storing episode metadata and audio blobs)
- **Data Parsing:** `fast-xml-parser` (for RSS feeds and OPML files)
- **Podcast Discovery:** iTunes Search API
- **Icons:** Lucide React
- **Environment:** Nix (via `shell.nix`)

## Architecture
The application follows a "local-first" architecture with a hybrid storage model:
1.  **State Management (Synced):** App state (subscriptions, playback progress) is managed in a local JSON file (Desktop) or internally in the browser's OPFS (Mobile). Data portability is ensured via manual **Import/Export** of the state JSON.
2.  **Download Management (Device-Specific):** Audio files and their associated metadata are stored in **IndexedDB**. This ensures downloads are persistent across sessions but remain specific to the local device (they are not synced via the JSON file).
3.  **Service Layer:** 
    - `src/services/podcastService.ts`: Handles RSS/OPML parsing and iTunes search logic. Uses CORS proxies for browser compatibility.
    - `src/services/storageService.ts`: Manages the IndexedDB lifecycle for offline episode storage.
4.  **Persistence Hook:** `src/hooks/useFileSystem.ts` abstracts the platform-specific storage logic (File System Access vs. OPFS).
5.  **Playback Logic:** 
    - Automatically checks for offline audio in IndexedDB before streaming from the web.
    - Initiates background downloads when playing a remote episode.
    - Periodically auto-saves playback position to the local state file (throttled to once every 10 seconds for performance).

## Project Structure
- `src/hooks/useFileSystem.ts`: Handles synced JSON state file reading/writing across platforms.
- `src/services/podcastService.ts`: RSS/OPML parsing and iTunes search logic.
- `src/services/storageService.ts`: IndexedDB wrapper for offline downloads.
- `src/types.ts`: TypeScript interfaces for Podcasts, Episodes, and App State.
- `src/App.tsx`: Main UI layout, search, playback controls, and download management.
- `shell.nix`: Reproducible development environment with Node.js 20 and npm.

## Building and Running

### Development Environment
The project uses **Nix** for a consistent development environment.
1.  Enter the shell:
    ```bash
    nix-shell
    ```
    *(This will automatically install npm dependencies if they are missing)*.

### Available Scripts
- `npm run dev`: Starts the Vite development server (default port: 5173).
- `npm run build`: Compiles the project using `tsc` and Vite for production.
- `npm run lint`: Runs ESLint for code quality checks.
- `npm run preview`: Previews the production build locally.
- **`npm run start-app`**: Builds the app and launches it in a standalone window (App Mode).

## Development Conventions
- **Type Safety:** Strict TypeScript is enforced.
- **Import Style:** Use `import type` for type-only imports.
- **Styling:** Use Tailwind CSS utility classes.
- **Persistence:** Metadata changes must sync with the local JSON file; binary audio must stay in IndexedDB.
- **Performance:** Avoid high-frequency disk writes; throttle state persistence during active playback.
- **CORS:** All RSS fetches must go through a CORS proxy to work in the browser.

## Future Plans (Strategic Roadmap)
All current and future development must align with these strategic goals. Changes should be designed to facilitate, or at least not hinder, the eventual implementation of these features.

### 1. Cloud API Integration (Automated Sync)
- **Goal:** Replace manual file-picking/importing with direct integration for **Google Drive** and **Dropbox**.
- **Requirement:** Implement OAuth2 flows and cloud-aware persistence logic in `useFileSystem.ts`.
- **Constraint:** Maintain the "local-first" philosophy by ensuring the user still owns the file in a visible cloud folder (e.g., `/Apps/PodPlayer/podcast_state.json`).

### 2. Native Mobile Application (Capacitor)
- **Goal:** Package the web app as a native Android/iOS app to bypass browser sandboxing.
- **Requirement:** Integrate Capacitor for native filesystem access and background audio support.
- **Constraint:** The codebase must remain "web-first" so that the PWA and Desktop versions continue to work identically.

### 3. Native File System Access for Mobile
- **Goal:** Use Android's Storage Access Framework (SAF) via Capacitor to allow the mobile app to "live-link" to a local JSON file, matching the Desktop experience.
- **Requirement:** Create a bridge between the browser's `useFileSystem` and native Android storage APIs.
