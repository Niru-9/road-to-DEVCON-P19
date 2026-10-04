import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The browser bundle is a pure static UI. It talks only to this app's own
// /api/* routes — it never contains a model API key, an RPC URL, or any other
// credential. See docs/acceptance-checklist.md, criterion 8.
export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})