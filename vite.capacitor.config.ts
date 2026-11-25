import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Standalone Vite client build for Capacitor Android / Google Play (.aab).
 * Bundles React + 3-Band LR4 WebAudio DSP locally into `dist/capacitor` while routing
 * API & R2 audio stems to `https://www.nootropic.fm`.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_CAPACITOR_NATIVE': JSON.stringify('true'),
    'import.meta.env.VITE_PLAY_STORE_BUILD': JSON.stringify('true'),
    'import.meta.env.VITE_API_BASE': JSON.stringify('https://www.nootropic.fm'),
  },
  build: {
    outDir: 'dist/capacitor',
    emptyOutDir: true,
    sourcemap: false,
  },
});
