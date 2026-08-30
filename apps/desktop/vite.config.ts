import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Le workspace n'est pas construit : on pointe directement les sources
    // partagées. Doit rester aligné sur `paths` dans tsconfig.json.
    alias: {
      '@catdesk/shared-types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts'),
    },
  },
  // Tauri expects a fixed port; fail if it's not available
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Ignore Rust source — Tauri CLI handles that
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'chrome105',
    minify: !process.env['TAURI_DEBUG'] ? 'esbuild' : false,
    sourcemap: !!process.env['TAURI_DEBUG'],
  },
});
