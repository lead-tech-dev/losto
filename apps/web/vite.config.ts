import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En développement, les appels /api sont redirigés vers l'API NestJS
    proxy: { '/api': 'http://localhost:3000' },
  },
});
