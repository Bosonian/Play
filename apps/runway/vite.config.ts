import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' (relative), not '/Play/…' like head-in. Runway is a separate
// app that will eventually be loaded by Capacitor from a local file:// or
// capacitor:// origin (increment 3+), where an absolute subpath base would
// 404. Relative asset URLs work under any hosting scheme, including a plain
// static server for browser testing now.
export default defineConfig({
  base: './',
  plugins: [react()],
});
