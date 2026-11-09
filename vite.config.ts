import { rmSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // public/mockServiceWorker.js is only for `dev:mock`; keep it out of real builds.
    {
      name: 'drop-msw-worker',
      apply: 'build',
      closeBundle() {
        if (mode !== 'mock') rmSync('dist/mockServiceWorker.js', { force: true });
      },
    },
  ],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'], // e2e/ is Playwright
    setupFiles: ['./src/test/setup.ts'],
  },
}));
