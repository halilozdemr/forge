import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://localhost:3131',
      '/api': 'http://localhost:3131',
      '/health': 'http://localhost:3131',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
