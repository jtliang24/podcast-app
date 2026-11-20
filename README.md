# 🎙️ Portable Podcast Player

A modern, local-first podcast listening application designed for privacy, portability, and performance. Built with React, TypeScript, and Tailwind CSS.

## ✨ Features

- **🚀 Local-First Architecture**: Local profiles use a JSON file. Drive profiles cache subscriptions, preferences, and listening progress in IndexedDB.
- **☁️ Cloud Sync**: Drive keeps the original profile as a starting snapshot and syncs subsequent edits through its private app-data folder. Pending edits survive offline use and reconnecting to the same account.
- **📥 Offline Listening**: Download episodes directly to your browser's IndexedDB for playback without an internet connection.
- **🔄 Session Continuity**: Pause on one device and choose **Continue listening** on another to resume at the saved position. Update both devices before using handoff.
- **📱 PWA Support**: Installable on Desktop and Mobile for a native-like experience.
- **🎵 System Integration**: Full support for the Media Session API, allowing control via lock screens, hardware buttons, and system media widgets.
- **📑 OPML Support**: Easily import or export your podcast subscriptions using standard OPML files.
- **🕒 Smart Queue**: Manage your listening order with a persistent, reorderable queue that stays in sync across sessions.

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

## 📜 License

This project is licensed under the MIT License.
