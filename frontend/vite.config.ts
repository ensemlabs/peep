/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  server: {
    port: 5173,
    // Convenience only: in production nginx proxies /api to the api service.
    proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: false } },
  },
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
