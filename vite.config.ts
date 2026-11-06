import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` lets the built app run from any folder or static host
// (e.g. GitHub Pages, a shared drive, or a clinic intranet).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { chunkSizeWarningLimit: 2500 },
});
