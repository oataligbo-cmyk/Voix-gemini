import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // En développement, les appels /api sont envoyés au Worker local (wrangler dev).
  server: { proxy: { '/api': 'http://localhost:8787' } }
});
