import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// No `base` here: Capacitor's WebView serves the built app from the
// filesystem root, not a GitHub Pages subpath. Do NOT copy the root
// Head-in app's `base: '/Play/'` — this app is never deployed to Pages.
// No PWA plugin either: installability comes from the native Capacitor
// shell (npx cap add android), not a web manifest + service worker.
export default defineConfig({
  plugins: [react()],
});
