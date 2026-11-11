import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En desarrollo, /api y /health van al backend local (puerto 4100). En producción los atiende Apache (estándar §15).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/api': 'http://127.0.0.1:4100',
      '/health': 'http://127.0.0.1:4100',
    },
  },
  build: { sourcemap: false },
});
