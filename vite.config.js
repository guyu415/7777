import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // VPS backend tests use Bun's native test runner and live in the same
    // repository only for source control/deployment. Vitest must not try to
    // resolve their `bun:test` imports.
    exclude: ['vps/**', 'node_modules/**', 'dist/**'],
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          store: ['zustand'],
        }
      }
    }
  }
})
