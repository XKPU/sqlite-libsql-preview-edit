import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Webview build: produces a single index.html (self-contained) plus asset chunks.
// The extension host injects these into the custom editor webview.
export default defineConfig({
  root: resolve(__dirname, 'webview'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'out/webview'),
    emptyOutDir: true,
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, 'webview/index.html'),
      output: {
        format: 'es',
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
});
