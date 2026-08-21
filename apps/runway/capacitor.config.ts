import type { CapacitorConfig } from '@capacitor/cli';

// appId is stable forever once installed on a device — changing it later
// creates a *new* app identity on the phone (separate data, separate
// install) rather than updating the existing one. Do not touch it casually.
const config: CapacitorConfig = {
  appId: 'de.bosonian.runway',
  appName: 'Runway',
  webDir: 'dist',
  android: {},
};

export default config;
