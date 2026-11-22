import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_API_BASE': JSON.stringify('https://nootropic-fm.edmondakadantes.workers.dev'),
  },
  build: {
    outDir: 'dist-pages',
    emptyOutDir: true,
  },
});
