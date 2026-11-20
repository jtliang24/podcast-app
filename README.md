# 🎙️ Portable Podcast Player

A modern, local-first podcast listening application designed for privacy, portability, and performance. Built with React, TypeScript, and Tailwind CSS.

## ✨ Features

- **🚀 Local-First Architecture**: Your data stays with you. Subscriptions and preferences are stored in a single JSON file.
- **☁️ Cloud Sync**: Seamlessly synchronize your library and playback progress across devices using Google Drive (via the secure `appDataFolder`).
- **📥 Offline Listening**: Download episodes directly to your browser's IndexedDB for playback without an internet connection.
- **🔄 Session Continuity**: Automatically remembers your last played episode and exact timestamp, even after closing the app.
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
