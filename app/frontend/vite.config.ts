import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/leads': 'http://localhost:8000',
      '/ingest': 'http://localhost:8000',
      '/settings': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/uploads': 'http://localhost:8000',
    },
  },
})
