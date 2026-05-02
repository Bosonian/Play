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
      // Make sure the SVG icon is precached by the service worker — the
      // manifest references it but the SW won't otherwise know to cache it.
      includeAssets: ['pwa-icon.svg'],
      // start_url and scope mirror `base` — they must include the subpath
      // for the installed PWA to navigate correctly.
      // theme_color / background_color match the warm palette so install
      // splash and Android Chrome chrome blend in.
      manifest: {
        name: 'PlayDHD',
        short_name: 'PlayDHD',
        description: 'Protect time for play.',
        theme_color: '#faf7f2',
        background_color: '#faf7f2',
        display: 'standalone',
        start_url: '/Play/',
        scope: '/Play/',
        icons: [
          {
            // Single SVG icon — Android Chrome supports SVG icons in
            // manifests and scales as needed. `purpose: 'any maskable'`
            // means it doubles as the maskable adaptive icon (content is
            // safely within the inner 80% safe zone).
            src: 'pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
});
