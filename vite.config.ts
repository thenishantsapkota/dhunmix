import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  // Pre-bundle essentia up front; discovering it on first analysis makes the dev server reload mid-import.
  optimizeDeps: { include: ['essentia.js/dist/essentia-wasm.es.js', 'essentia.js/dist/essentia.js-core.es.js'] },
})
