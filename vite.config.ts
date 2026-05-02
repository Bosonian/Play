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
      // theme_color / background_color match the warm palette (tailwind.config.ts
      // colors.paper.DEFAULT) so install splash + chrome blend in.
      manifest: {
        name: 'PlayDHD',
        short_name: 'PlayDHD',
        description: 'Protect time for play.',
        theme_color: '#faf7f2',
        background_color: '#faf7f2',
        display: 'standalone',
        start_url: '/Play/',
        scope: '/Play/',
        // Real icons land in §9 step 10 of the brief.
        icons: [],
      },
    }),
  ],
});
