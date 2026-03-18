# Podcast Player Project Overview

A portable, local-first podcast listening application built with **React**, **TypeScript**, and **Vite**. The app is designed for performance and portability, storing all user data (subscriptions and playback progress) in a single, user-selected JSON file via the **File System Access API**.

## Core Technologies
- **Frontend:** React 19, TypeScript, Tailwind CSS
- **Build Tool:** Vite 6
- **Data Persistence:** File System Access API (Native browser API for local file I/O)
- **Data Parsing:** `fast-xml-parser` (for RSS feeds and OPML files)
- **Podcast Discovery:** iTunes Search API
- **Icons:** Lucide React
- **Environment:** Nix (via `shell.nix`)

## Architecture
The application follows a "local-first" architecture:
1.  **State Management:** App state (subscriptions, progress) is managed in a local JSON file. This allows users to sync their data by placing the file in a cloud-synced folder (e.g., Google Drive, Dropbox).
2.  **Service Layer:** `src/services/podcastService.ts` handles all external data fetching and XML/RSS parsing. It uses a public CORS proxy (`api.allorigins.win`) to fetch RSS feeds directly in the browser.
3.  **Persistence Hook:** `src/hooks/useFileSystem.ts` abstracts the File System Access API, providing methods to open, create, and auto-save the application state.
4.  **Playback Logic:** A persistent global audio player in `App.tsx` tracks playback progress and auto-saves the current position every second to the local state file.

## Project Structure
- `src/hooks/useFileSystem.ts`: Handles local JSON file reading/writing.
- `src/services/podcastService.ts`: RSS/OPML parsing and iTunes search logic.
- `src/types.ts`: TypeScript interfaces for Podcasts, Episodes, and App State.
- `src/App.tsx`: Main UI layout, search, and playback controls.
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

## Development Conventions
- **Type Safety:** Strict TypeScript is enforced.
- **Import Style:** Use `import type` for type-only imports (enforced by `verbatimModuleSyntax` in `tsconfig`).
- **Styling:** Use Tailwind CSS utility classes.
- **Persistence:** Ensure any state-changing actions call `updateState` to sync with the local JSON file.
- **CORS:** All RSS fetches must go through a CORS proxy to work in the browser.
