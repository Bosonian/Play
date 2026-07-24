import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' (relative), mirroring apps/runway — Tide is headed the same
// direction (Capacitor 7 + local file:// / capacitor:// origin in
// increment 2), where an absolute subpath base like head-in's '/Play/'
// would 404. Relative asset URLs work under any hosting scheme, including
// this increment's plain Vite dev server / static preview.
export default defineConfig({
  base: './',
  plugins: [react()],
});
