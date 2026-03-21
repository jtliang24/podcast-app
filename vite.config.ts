import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import mkcert from 'vite-plugin-mkcert'

// https://vite.dev/config/
export default defineConfig({
  server: {
    https: {},
    allowedHosts: true,
  },
  plugins: [
    react(),
    mkcert({
      hosts: ['localhost', '127.0.0.1', '192.168.1.153', '192.168.1.153.sslip.io'],
    }),
    VitePWA({
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
})

