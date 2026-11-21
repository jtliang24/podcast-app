import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.jtliang24.podcastapp',
  appName: 'Podcast Player',
  webDir: 'dist',
  loggingBehavior: 'none',
  android: { adjustMarginsForEdgeToEdge: 'auto' },
};

export default config;
