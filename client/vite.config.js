import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The React app calls /api/...; Vite forwards it to the Express server (no CORS hassle)
    proxy: { '/api': 'http://localhost:4000' },
  },
});
