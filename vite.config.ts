import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base: '/Play/' — GitHub Pages serves project sites at <user>.github.io/<repo>/.
// Without this, all asset URLs would be absolute-from-root and 404 in production.
// If we ever move to a custom domain or move off GH Pages, set this back to '/'.
export default defineConfig({
  base: '/Play/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // start_url and scope mirror `base` — they must include the subpath
      // for the installed PWA to navigate correctly.
      manifest: {
        name: 'PlayDHD',
        short_name: 'PlayDHD',
        description: 'Protect time for play.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/Play/',
        scope: '/Play/',
        // Real icons land in §9 step 10 of the brief. Keeping this empty for now
        // so the build doesn't fail on missing assets; vite-plugin-pwa will warn.
        icons: [],
      },
    }),
  ],
});
