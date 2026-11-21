import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import mkcert from 'vite-plugin-mkcert'
import { substackFeedPlugin } from './server/substackFeed'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  envPrefix: mode === 'android' ? 'VITE_ANDROID_' : 'VITE_',
  server: {
    https: {},
    allowedHosts: true,
  },
  plugins: [
    substackFeedPlugin,
    react(),
    mkcert({
      hosts: ['localhost', '127.0.0.1', '192.168.1.153', '192.168.1.153.sslip.io'],
    }),
    VitePWA({
      disable: mode === 'android',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Podcast Player',
        short_name: 'PodPlayer',
        description: 'Local-first, syncable podcast listening app',
        theme_color: '#0f172a',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml'
          }
        ],
        display: 'standalone',
        background_color: '#0f172a'
      },
      devOptions: {
        enabled: true
      }
    })
  ],
  define: {
    'process.env': {},
  }
}))

