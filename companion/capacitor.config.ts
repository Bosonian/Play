import type { CapacitorConfig } from '@capacitor/cli';

// appName is the launcher label shown under the home-screen icon on the
// patient's phone. Deliberately "Companion" — not naming the disease, the
// drug, or anything clinical — because de-identification extends to what a
// passer-by reads off the home screen, not just what's stored in the app.
const config: CapacitorConfig = {
  appId: 'app.dosing.companion',
  appName: 'Companion',
  webDir: 'dist',
  android: {
    // OCR calls contain inline photo bytes. Keep Capacitor from logging any
    // plugin call payload, including in locally distributed debug builds.
    loggingBehavior: 'none',
  },
};

export default config;
