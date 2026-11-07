import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cirro.android',
  appName: 'Cirro',
  webDir: 'dist-android',
  android: { path: 'native/android', backgroundColor: '#ffffff' },
  // USB-only development: adb reverse exposes the PC's loopback Vite server.
  // Omitted from normal APKs so production always uses packaged assets.
  ...(process.env.CIRRO_ANDROID_LIVE === '1' ? { server: { url: 'http://localhost:1423/android', cleartext: true } } : {}),
  plugins: {
    SystemBars: { style: 'LIGHT', insetsHandling: 'disable', initialViewportFitValueHint: 'cover' },
    SocialLogin: {
      providers: { google: true, facebook: false, apple: false, twitter: false },
      logLevel: 0,
    },
  },
};
export default config;
