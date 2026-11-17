import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` lets the built app run from any folder or static host
// (e.g. GitHub Pages, a shared drive, or a clinic intranet).
export default defineConfig({
  plugins: [react()],
  // furniture models (src/assets/models) are imported as files
  assetsInclude: ['**/*.glb'],
  base: './',
  // (models are embedded in their own small scripts, so the app is plain static files to host)
  build: { chunkSizeWarningLimit: 2500, assetsInlineLimit: (file) => (file.endsWith('.glb') ? true : undefined) },
});
