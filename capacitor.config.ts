import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kaiwatube.app',
  appName: 'KaiwaTube',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#121316',
    allowMixedContent: false,
  },
  plugins: {
    CapacitorHttp: {
      enabled: false,
    },
    StatusBar: {
      overlaysWebView: false,
      backgroundColor: '#121316',
      style: 'DARK',
    },
  },
};

export default config;
