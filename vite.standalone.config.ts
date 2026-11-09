import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build used by tools/make-standalone.mjs to produce one self-contained HTML file:
// everything in a single script (no lazy-loaded chunks) and assets inlined.
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist-standalone',
    emptyOutDir: true,
    chunkSizeWarningLimit: 10000,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
