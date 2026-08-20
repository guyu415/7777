import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Import only the wrapper's pure browser modules. Its public root also
    // exports native archive helpers, which would otherwise pull Expo/React
    // Native dependencies into this ordinary Vite application.
    alias: {
      '@eunoia/sherpa-web-impl': fileURLToPath(new URL('./node_modules/@siteed/sherpa-onnx.rn/lib/module/WebSherpaOnnxImpl.js', import.meta.url)),
      '@eunoia/sherpa-asr-service': fileURLToPath(new URL('./node_modules/@siteed/sherpa-onnx.rn/lib/module/services/AsrService.js', import.meta.url)),
      '@eunoia/sherpa-wasm-loader': fileURLToPath(new URL('./node_modules/@siteed/sherpa-onnx.rn/lib/module/web/wasmLoader.js', import.meta.url)),
    },
  },
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
