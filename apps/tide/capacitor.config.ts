import type { CapacitorConfig } from '@capacitor/cli';

// Mirrors apps/runway/capacitor.config.ts exactly (see its own comment for
// the full reasoning). appId is stable forever once installed on a device —
// changing it later creates a *new* app identity on the phone (separate
// data, separate install) rather than updating the existing one. Do not
// touch it casually.
const config: CapacitorConfig = {
  appId: 'de.bosonian.tide',
  appName: 'Tide',
  webDir: 'dist',
  android: {},
};

export default config;
