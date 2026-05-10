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
      '/auth': 'http://localhost:8000',
      '/admin': 'http://localhost:8000',
      '/users': 'http://localhost:8000',
      '/push': 'http://localhost:8000',
      '/jobs': 'http://localhost:8000',
      '/square': 'http://localhost:8000',
      '/finance': 'http://localhost:8000',
      '/chat': 'http://localhost:8000',
    },
  },
})
